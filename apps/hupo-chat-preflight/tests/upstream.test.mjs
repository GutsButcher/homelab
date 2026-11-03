import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { inputs, optionalImport } from './helpers.mjs';
const upstream = await optionalImport('../base/runtime/upstream.mjs');

function transport(answer, calls = []) {
  return (options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.destroy = error => { queueMicrotask(() => request.emit('error', error || new Error('destroyed canary'))); };
    request.end = () => queueMicrotask(() => {
      const result = answer(options);
      const response = new PassThrough();
      response.statusCode = result.status ?? 200;
      response.headers = {};
      callback(response);
      response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    });
    return request;
  };
}

function answer(options) {
  const data = inputs();
  if (options.path === '/api/v1/nodes/node01') return { body: data.node };
  if (options.path === '/apis/metrics.k8s.io/v1beta1/nodes/node01') return { body: data.metrics };
  const pod = { spec: { nodeName: 'node01', containers: [{ name: 'a', resources: { requests: { cpu: '1m', memory: '1Mi' } },
    env: [{ name: 'SECRET', value: 'secret-canary' }] }] }, status: { phase: 'Running', podIP: '10.0.0.3' } };
  return { body: { metadata: { resourceVersion: '1', continue: options.path.includes('continue=') ? '' : 'opaque+/=' },
    items: [pod] } };
}

test('API uses mounted CA, hostname verification and fixed read paths with complete pagination', async () => {
  assert.equal(typeof upstream.KubeReader, 'function');
  const calls = [];
  const files = [];
  const reader = new upstream.KubeReader({ request: transport(answer, calls), read: async path => {
    files.push(path);
    return path.endsWith('/token') ? 'token-canary\n' : 'mounted-ca';
  } });
  const result = await reader.readInputs('node01', new AbortController().signal);
  assert.equal(result.pods.length, 2);
  assert.equal(calls.length, 4);
  for (const options of calls) {
    assert.equal(options.hostname, 'kubernetes.default.svc.cluster.local');
    assert.equal(options.servername, options.hostname);
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.port, 443);
    assert.equal(options.method, 'GET');
    assert.equal(options.ca, 'mounted-ca');
    assert.equal(options.headers.Authorization, 'Bearer token-canary');
  }
  assert.equal(calls.some(c => c.path === '/api/v1/pods?limit=100&continue=opaque%2B%2F%3D'), true);
  assert.deepEqual(files.sort(), ['/var/run/secrets/kubernetes.io/serviceaccount/ca.crt',
    '/var/run/secrets/kubernetes.io/serviceaccount/token'].sort());
  assert.doesNotMatch(JSON.stringify(result), /secret-canary|10\.0\.0\.3|token-canary/);
  await assert.rejects(reader.readInputs('../secrets', new AbortController().signal), /NODE_UNKNOWN/);
});

test('public certificate fetch never sends bearer authorization or follows redirects', async () => {
  assert.equal(typeof upstream.fetchPublicCertificate, 'function');
  const calls = [];
  const result = await upstream.fetchPublicCertificate(new AbortController().signal,
    transport(() => ({ body: 'public-certificate-fixture' }), calls));
  assert.equal(result, 'public-certificate-fixture');
  assert.equal(calls[0].hostname, 'sealed-secrets-controller.sealed-secrets.svc.cluster.local');
  assert.equal(calls[0].port, 8080);
  assert.equal(calls[0].path, '/v1/cert.pem');
  assert.equal(calls[0].headers.Authorization, undefined);
  await assert.rejects(upstream.fetchPublicCertificate(new AbortController().signal,
    transport(() => ({ status: 302, body: 'raw secret-canary' }))), /^Error: CERT_UNAVAILABLE$/);
});

test('only the own-PVC fixed path is statfs-read with bigint values', async () => {
  assert.equal(typeof upstream.readOwnDisk, 'function');
  const calls = [];
  const disk = await upstream.readOwnDisk(async (...args) => { calls.push(args); return inputs().disk; });
  assert.deepEqual(calls, [['/probe-storage', { bigint: true }]]);
  assert.equal(disk.bsize, 4096n);
});

test('incomplete lists, changed snapshots, oversized bodies and API failures cannot become success', async () => {
  assert.equal(typeof upstream.KubeReader, 'function');
  for (const override of [() => ({ status: 403, body: 'raw secret-canary' }),
    () => ({ body: 'x'.repeat(2200000) }),
    o => o.path.startsWith('/api/v1/pods') ? { body: { items: [], metadata: { resourceVersion: '1', remainingItemCount: 1 } } } : answer(o),
    o => o.path.startsWith('/api/v1/pods') ? { body: { items: [], metadata: { resourceVersion: o.path.includes('continue=') ? '2' : '1',
      continue: o.path.includes('continue=') ? '' : 'next' } } } : answer(o)]) {
    const reader = new upstream.KubeReader({ request: transport(override), read: async () => 'fixture' });
    await assert.rejects(reader.readInputs('node01', new AbortController().signal), /^Error: API_UNAVAILABLE$/);
  }
});
