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
      response.headers = result.headers || {};
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

test('authenticated certificate fetch uses only the fixed verified API service proxy', async () => {
  assert.equal(typeof upstream.fetchAuthenticatedCertificate, 'function');
  assert.equal(typeof upstream.KubeReader.prototype.readCertificate, 'function');
  const calls = [];
  const files = [];
  const signal = new AbortController().signal;
  const reader = new upstream.KubeReader({
    request: transport(() => ({ body: 'public-certificate-fixture' }), calls),
    read: async (...args) => {
      files.push(args);
      return args[0].endsWith('/token') ? 'token-canary\n' : 'mounted-ca';
    }
  });
  assert.equal(await upstream.fetchAuthenticatedCertificate(signal, reader), 'public-certificate-fixture');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    hostname: 'kubernetes.default.svc.cluster.local', port: 443,
    path: '/api/v1/namespaces/sealed-secrets/services/sealed-secrets-controller:8080/proxy/v1/cert.pem',
    servername: 'kubernetes.default.svc.cluster.local', rejectUnauthorized: true, ca: 'mounted-ca',
    headers: { Accept: 'application/x-pem-file', Authorization: 'Bearer token-canary' },
    signal, method: 'GET', agent: false, maxHeaderSize: 8192
  });
  assert.deepEqual(files.sort(), [
    ['/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8'],
    ['/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8']
  ]);
});

test('authenticated certificate reads fail closed on denial, redirects, byte overflow and raw errors', async () => {
  for (const result of [
    { status: 301, headers: { location: 'http://untrusted.example/cert.pem' }, body: 'raw secret-canary' },
    { status: 302, headers: { location: '/v1/cert.pem' }, body: 'raw secret-canary' },
    { status: 307, body: 'raw secret-canary' }, { status: 308, body: 'raw secret-canary' },
    { status: 401, body: 'raw secret-canary' }, { status: 403, body: 'raw secret-canary' },
    { status: 500, body: 'raw secret-canary' }, { body: 'x'.repeat(32769) }, { body: 'é'.repeat(16385) }
  ]) {
    const calls = [];
    const reader = new upstream.KubeReader({ request: transport(() => result, calls), read: async () => 'fixture' });
    await assert.rejects(reader.readCertificate(new AbortController().signal), /^Error: CERT_UNAVAILABLE$/);
    assert.equal(calls.length, 1, 'there must be no fallback or redirected request');
    assert.equal(calls[0].hostname, 'kubernetes.default.svc.cluster.local');
  }
  const reader = new upstream.KubeReader({ request: transport(() => ({ body: 'x'.repeat(32768) })), read: async () => 'fixture' });
  assert.equal((await reader.readCertificate(new AbortController().signal)).length, 32768);
  const failed = new upstream.KubeReader({ read: async () => 'fixture', request: () => { throw new Error('raw secret-canary'); } });
  await assert.rejects(failed.readCertificate(new AbortController().signal), /^Error: CERT_UNAVAILABLE$/);
});

test('authenticated certificate reads reject unusable mounted credentials before making any request', async () => {
  for (const [token, ca] of [['', 'ca'], [' \n', 'ca'], ['token\ncanary', 'ca'], ['token\rcanary', 'ca'], ['token', '']]) {
    const calls = [];
    const reader = new upstream.KubeReader({ request: transport(() => ({ body: 'unexpected' }), calls),
      read: async path => path.endsWith('/token') ? token : ca });
    await assert.rejects(reader.readCertificate(new AbortController().signal), /^Error: CERT_UNAVAILABLE$/);
    assert.equal(calls.length, 0);
  }
  const reader = new upstream.KubeReader({ read: async () => { throw new Error('raw secret-canary'); },
    request: () => assert.fail('missing credentials must not cause a request') });
  await assert.rejects(reader.readCertificate(new AbortController().signal), /^Error: CERT_UNAVAILABLE$/);
});

test('ambient proxy, API-host and TLS environment cannot change the authenticated certificate target', async () => {
  const overrides = { HTTPS_PROXY: 'http://untrusted.example', HTTP_PROXY: 'http://untrusted.example',
    ALL_PROXY: 'http://untrusted.example', KUBERNETES_SERVICE_HOST: 'untrusted.example',
    KUBERNETES_SERVICE_PORT: '80', NODE_TLS_REJECT_UNAUTHORIZED: '0' };
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const calls = [];
    const reader = new upstream.KubeReader({ request: transport(() => ({ body: 'fixture' }), calls), read: async () => 'mounted' });
    await reader.readCertificate(new AbortController().signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hostname, 'kubernetes.default.svc.cluster.local');
    assert.equal(calls[0].servername, calls[0].hostname);
    assert.equal(calls[0].port, 443);
    assert.equal(calls[0].rejectUnauthorized, true);
    assert.equal(calls[0].agent, false);
    assert.equal(calls[0].ca, 'mounted');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('authenticated certificate request deadline destroys unresponsive transport', { timeout: 6000 }, async () => {
  let destroyed = 0;
  const reader = new upstream.KubeReader({ read: async () => 'fixture', request: () => {
    const request = new EventEmitter();
    request.end = () => {};
    request.destroy = () => { destroyed++; request.emit('error', new Error('raw secret-canary')); };
    return request;
  } });
  await assert.rejects(reader.readCertificate(new AbortController().signal), /^Error: CERT_UNAVAILABLE$/);
  assert.equal(destroyed, 1);
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
