import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFile, statfs } from 'node:fs/promises';

const API_HOST = 'kubernetes.default.svc.cluster.local';
const CERT_HOST = 'sealed-secrets-controller.sealed-secrets.svc.cluster.local';
const CERT_API_PATH = '/api/v1/namespaces/sealed-secrets/services/sealed-secrets-controller:8080/proxy/v1/cert.pem';
const SA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount';
const TARGET_NODE = 'node01';

export class KubeReader {
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

  async readCertificate(signal) {
    try {
      const options = await this.#credentials();
      return await boundedGet(this.request, { ...options, path: CERT_API_PATH,
        headers: { ...options.headers, Accept: 'application/x-pem-file' }, signal }, 32768, 'CERT_UNAVAILABLE');
    } catch { throw new Error('CERT_UNAVAILABLE'); }
  }

  async #credentials() {
    const [token, ca] = await Promise.all([this.read(`${SA_PATH}/token`, 'utf8'), this.read(`${SA_PATH}/ca.crt`, 'utf8')]);
    const bearer = token.trim();
    if (!bearer || /[\r\n]/.test(bearer) || !ca) throw new Error();
    return { hostname: API_HOST, port: 443, servername: API_HOST, rejectUnauthorized: true, ca,
      headers: { Authorization: `Bearer ${bearer}` } };
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

function boundedGet(request, options, maxBytes, code) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(new Error(code));
      else resolve(value);
    };
    try {
      const req = request({ ...options, method: 'GET', agent: false, maxHeaderSize: 8192 }, response => {
        response.on('error', () => finish(true));
        response.on('aborted', () => finish(true));
        if (finished || response.statusCode !== 200) {
          finish(true);
          response.resume();
          req.destroy();
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', chunk => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(true);
            response.destroy();
            req.destroy();
          } else chunks.push(chunk);
        });
        response.on('end', () => finish(false, Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', () => finish(true));
      timer = setTimeout(() => { finish(true); req.destroy(); }, 3500);
      req.end();
    } catch { finish(true); }
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
