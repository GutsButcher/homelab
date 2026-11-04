import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFile, statfs } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { applicationSample, unknownApplicationSample } from './application.mjs';

const API_HOST = 'kubernetes.default.svc.cluster.local';
const CERT_HOST = 'sealed-secrets-controller.sealed-secrets.svc.cluster.local';
const CERT_API_PATH = '/api/v1/namespaces/sealed-secrets/services/sealed-secrets-controller:8080/proxy/v1/cert.pem';
const SA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount';
const TARGET_NODE = 'node01';

export class KubeReader {
  #applicationPreparation = null;

  constructor({ request = httpsRequest, read = readFile } = {}) {
    this.request = request;
    this.read = read;
  }

  async readInputs(ownNode, signal) {
    if (ownNode !== TARGET_NODE) throw new Error('NODE_UNKNOWN');
    try {
      const options = await this.#credentials();
      const get = async path => JSON.parse(await boundedGet(this.request, { ...options, path,
        headers: { ...options.headers, Accept: 'application/json' }, signal }, 2097152, 'API_UNAVAILABLE'));
      const [node, metrics, pods] = await Promise.all([
        get(`/api/v1/nodes/${ownNode}`), get(`/apis/metrics.k8s.io/v1beta1/nodes/${ownNode}`), this.#pods(get, ownNode)
      ]);
      return { node: { metadata: { name: node.metadata?.name }, spec: { unschedulable: node.spec?.unschedulable },
        status: { allocatable: node.status?.allocatable, conditions: node.status?.conditions?.map(c => ({ type: c.type, status: c.status })) } },
        metrics: { metadata: { name: metrics.metadata?.name }, timestamp: metrics.timestamp, window: metrics.window,
          usage: { cpu: metrics.usage?.cpu, memory: metrics.usage?.memory } }, pods };
    } catch { throw new Error('API_UNAVAILABLE'); }
  }

  async readApplication(signal, clock = Date.now, deadline = clock() + 8000) {
    const budget = new OptionalRead(signal, clock, deadline);
    try {
      budget.check();
      const options = await budget.wait(ready => this.#applicationCredentials(ready));
      budget.check();
      const text = await boundedGet(this.request, { ...options,
        path: '/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/hupo-chat',
        headers: { ...options.headers, Accept: 'application/json' }, signal }, 262144, 'UNAVAILABLE', true, budget);
      budget.check();
      let sample;
      try { sample = applicationSample(JSON.parse(text), clock()); }
      catch { sample = unknownApplicationSample('MALFORMED'); }
      budget.check();
      return sample;
    } catch (error) {
      return unknownApplicationSample(budget.active() && ['DENIED', 'MISSING', 'MALFORMED'].includes(error?.message) ? error.message : 'UNAVAILABLE');
    } finally { budget.close(); }
  }

  async readCertificate(signal) {
    try {
      const options = await this.#credentials();
      return await boundedGet(this.request, { ...options, path: CERT_API_PATH,
        headers: { ...options.headers, Accept: 'application/x-pem-file' }, signal }, 32768, 'CERT_UNAVAILABLE');
    } catch { throw new Error('CERT_UNAVAILABLE'); }
  }

  async #credentials(waitForAll = false) {
    const reads = [`${SA_PATH}/token`, `${SA_PATH}/ca.crt`].map(path => waitForAll ?
      Promise.resolve().then(() => this.read(path, 'utf8')) : this.read(path, 'utf8'));
    // A failed peer cannot release the optional lock while another raw read is pending.
    const values = waitForAll ? (await Promise.allSettled(reads)).map(result => {
      if (result.status !== 'fulfilled') throw new Error();
      return result.value;
    }) : await Promise.all(reads);
    const [token, ca] = values;
    const bearer = token.trim();
    if (!bearer || /[\r\n]/.test(bearer) || !ca) throw new Error();
    return { hostname: API_HOST, port: 443, servername: API_HOST, rejectUnauthorized: true, ca,
      headers: { Authorization: `Bearer ${bearer}` } };
  }

  #applicationCredentials(ready) {
    if (!this.#applicationPreparation) {
      const subscribers = new Set();
      this.#applicationPreparation = subscribers;
      const finish = (error, options) => {
        this.#applicationPreparation = null;
        for (const subscriber of subscribers) subscriber(error, options);
        subscribers.clear();
      };
      this.#credentials(true).then(options => finish(null, options), () => finish(new Error('UNAVAILABLE')));
    }
    const subscribers = this.#applicationPreparation;
    subscribers.add(ready);
    return () => subscribers.delete(ready);
  }

  async #pods(get, ownNode) {
    const pods = [];
    const seen = new Set();
    let continuation = '';
    let revision;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ limit: '100' });
      if (continuation) query.set('continue', continuation);
      const list = await get(`/api/v1/pods?${query}`);
      if (!Array.isArray(list.items) || typeof list.metadata?.resourceVersion !== 'string' || !list.metadata.resourceVersion) throw new Error();
      revision ||= list.metadata.resourceVersion;
      if (revision !== list.metadata.resourceVersion) throw new Error();
      for (const pod of list.items) {
        if (pod.spec?.nodeName !== ownNode || ['Succeeded', 'Failed'].includes(pod.status?.phase)) continue;
        pods.push(resourceOnlyPod(pod));
      }
      continuation = list.metadata.continue || '';
      if (!continuation) {
        if (list.metadata.remainingItemCount > 0) throw new Error();
        return pods;
      }
      if (typeof continuation !== 'string' || continuation.length > 4096 || seen.has(continuation)) throw new Error();
      seen.add(continuation);
    }
    throw new Error();
  }
}

export function fetchAuthenticatedCertificate(signal, reader = new KubeReader()) {
  return reader.readCertificate(signal);
}

export function fetchPublicCertificate(signal, request = httpRequest) {
  return boundedGet(request, { hostname: CERT_HOST, port: 8080, path: '/v1/cert.pem',
    headers: { Accept: 'application/x-pem-file' }, signal }, 32768, 'CERT_UNAVAILABLE');
}

export function readOwnDisk(inspect = statfs) {
  return inspect('/probe-storage', { bigint: true });
}

class OptionalRead {
  constructor(parent, clock, deadline) {
    this.parent = parent;
    this.clock = clock;
    this.wallEnd = deadline - 50;
    const remaining = deadline - clock();
    this.end = performance.now() + Math.min(750, remaining - 50);
    this.abort = new AbortController();
    this.signal = this.abort.signal;
    this.cancel = () => this.abort.abort();
    if (!Number.isFinite(remaining) || remaining < 800 || parent?.aborted) this.cancel();
    else {
      parent?.addEventListener('abort', this.cancel, { once: true });
      this.timer = setTimeout(this.cancel, this.remaining());
    }
  }

  remaining() { return Math.min(this.end - performance.now(), this.wallEnd - this.clock()); }
  active() { return !this.signal.aborted && this.remaining() > 0; }
  check() { if (!this.active()) throw new Error('UNAVAILABLE'); }

  wait(subscribe) {
    return new Promise((resolve, reject) => {
      let finished = false;
      let unsubscribe = () => {};
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        unsubscribe();
        this.signal.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(new Error('UNAVAILABLE'));
      if (!this.active()) { cancel(); return; }
      this.signal.addEventListener('abort', cancel, { once: true });
      unsubscribe = subscribe(finish);
      if (!this.active()) cancel();
    });
  }

  close() {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.cancel);
  }
}

function boundedGet(request, options, maxBytes, code, application = false, budget) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer;
    let req;
    let incoming;
    const signal = budget?.signal || options.signal;
    const cancel = () => { if (finished) return; finish(true); incoming?.destroy(); req?.destroy(); };
    const finish = (error, value) => {
      if (finished) return;
      if (!error && application && !budget.active()) { cancel(); return; }
      finished = true;
      clearTimeout(timer);
      if (application) signal?.removeEventListener('abort', cancel);
      if (error) reject(new Error(typeof error === 'string' ? error : code));
      else resolve(value);
    };
    try {
      if (application && !budget.active()) { finish(true); return; }
      req = request({ ...options, method: 'GET', agent: false, maxHeaderSize: 8192 }, response => {
        incoming = response;
        response.on('error', () => finish(true));
        response.on('aborted', () => finish(true));
        if (finished || response.statusCode !== 200) {
          const status = response.statusCode;
          finish(application ? ([401, 403].includes(status) ? 'DENIED' : status === 404 ? 'MISSING' : 'UNAVAILABLE') : true);
          response.resume();
          req.destroy();
          return;
        }
        if (application && ((response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity') ||
            (response.headers?.['content-length'] !== undefined &&
            (!/^\d+$/.test(response.headers['content-length']) || Number(response.headers['content-length']) > maxBytes)))) {
          finish('MALFORMED'); response.destroy(); req.destroy(); return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(application ? 'MALFORMED' : true);
            response.destroy();
            req.destroy();
          } else if (!finished) chunks.push(chunk);
        });
        response.on('end', () => finish(false, Buffer.concat(chunks).toString('utf8')));
        if (application) response.on('close', () => { if (!finished) cancel(); });
      });
      req.on('error', () => finish(true));
      if (application) signal?.addEventListener('abort', cancel, { once: true });
      else timer = setTimeout(() => { finish(true); incoming?.destroy(); req.destroy(); }, 3500);
      if (application && !budget.active()) { cancel(); return; }
      req.end();
    } catch { finish(true); req?.destroy(); }
  });
}

function resourceOnlyPod(pod) {
  const container = c => ({ name: c.name, restartPolicy: c.restartPolicy, resources: { requests: c.resources?.requests } });
  const status = c => ({ name: c.name, resources: c.resources, allocatedResources: c.allocatedResources });
  return { spec: { nodeName: pod.spec.nodeName, containers: pod.spec.containers?.map(container),
    initContainers: pod.spec.initContainers?.map(container), overhead: pod.spec.overhead, resources: pod.spec.resources },
    status: { phase: pod.status?.phase, conditions: pod.status?.conditions?.map(c => ({ type: c.type, reason: c.reason })),
      containerStatuses: pod.status?.containerStatuses?.map(status), initContainerStatuses: pod.status?.initContainerStatuses?.map(status) } };
}
