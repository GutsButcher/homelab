import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { KubeReader } from '../base/runtime/upstream.mjs';
import { now } from './helpers.mjs';
import { performance } from 'node:perf_hooks';
import { application, known, unknown } from './diagnostic-fixtures.mjs';

export function wire(result, calls = []) {
  return (options, callback) => {
    calls.push(options);
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = result.status ?? 200; response.headers = result.headers || {};
      callback(response);
      response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? application()));
    });
    return req;
  };
}

for (const [status, reason] of [[401, 'DENIED'], [403, 'DENIED'], [404, 'MISSING'], [302, 'UNAVAILABLE'], [500, 'UNAVAILABLE']]) {
  test(`optional Argo GET ${status} becomes UNKNOWN ${reason} without reporting unhealthy or fallback`, async () => {
    const calls = [];
    const reader = new KubeReader({ read: async () => 'fixture', request: wire({ status, body: 'raw-secret-canary' }, calls) });
    const sample = await reader.readApplication(new AbortController().signal, () => now);
    assert.deepEqual(sample.application, { state: 'UNKNOWN', identityMatches: null, reportedHealthy: null,
      syncedExpected: null, idle: null, reason });
    assert.equal(calls.length, 1);
    assert.doesNotMatch(JSON.stringify(sample), /raw-secret-canary/);
  });
}

test('optional Argo response rejects malformed, compressed, byte overflow and announced overflow', async () => {
  for (const result of [
    { body: '{not-json' }, { body: [] }, { body: 'x'.repeat(262145) },
    { body: application(), headers: { 'content-length': '262145' } },
    { body: application(), headers: { 'content-encoding': 'gzip' } }
  ]) {
    const reader = new KubeReader({ read: async () => 'fixture', request: wire(result) });
    assert.equal((await reader.readApplication(new AbortController().signal, () => now)).application.reason, 'MALFORMED');
  }
  const body = JSON.stringify(application());
  const reader = new KubeReader({ read: async () => 'fixture', request: wire({ body: body + ' '.repeat(262144 - body.length) }) });
  assert.deepEqual((await reader.readApplication(new AbortController().signal, () => now)).application, known);
});

test('optional Argo absolute 750ms transport bound covers headers and body and aborts without late success', { timeout: 2500 }, async () => {
  let destroyed = 0;
  const reader = new KubeReader({ read: async () => 'fixture', request: (_options, callback) => {
    const req = new EventEmitter(); req.destroy = () => { destroyed++; };
    req.end = () => queueMicrotask(() => { const response = new PassThrough(); response.statusCode = 200; callback(response); });
    return req;
  } });
  const sample = await reader.readApplication(new AbortController().signal, () => now);
  assert.equal(sample.application.reason, 'UNAVAILABLE');
  assert.equal(destroyed, 1);
});

test('optional Argo shares refresh abort, including pre-abort, without a caller-selected path', async () => {
  const abort = new AbortController(); let destroyed = 0; let endResponse;
  const calls = [];
  const reader = new KubeReader({ read: async () => 'fixture', request: (options, callback) => {
    calls.push(options);
    const req = new EventEmitter(); req.destroy = () => { destroyed++; };
    req.end = () => queueMicrotask(() => {
      const response = new PassThrough(); response.statusCode = 200; callback(response); endResponse = () => response.end(JSON.stringify(application()));
      abort.abort();
    });
    return req;
  } });
  const sample = await reader.readApplication(abort.signal, () => now);
  assert.equal(sample.application.reason, 'UNAVAILABLE');
  endResponse();
  assert.equal(sample.application.state, 'UNKNOWN');
  assert.equal(destroyed, 1);
  await reader.readApplication(abort.signal, () => now);
  assert.equal(calls.length, 1, 'pre-aborted work must not open a second request');
});

test('optional Argo transport uses only fixed verified GET with projected identity and sanitizes raw state', async () => {
  assert.equal(typeof KubeReader.prototype.readApplication, 'function');
  const calls = []; const files = [];
  const data = application(); data.metadata.annotations = { raw: 'raw-secret-canary' };
  const reader = new KubeReader({ request: wire({ body: data }, calls), read: async (...args) => {
    files.push(args); return args[0].endsWith('/token') ? 'token-canary\n' : 'mounted-ca';
  } });
  const signal = new AbortController().signal;
  const sample = await reader.readApplication(signal, () => now);
  assert.deepEqual(sample.application, known);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { hostname: 'kubernetes.default.svc.cluster.local', port: 443,
    servername: 'kubernetes.default.svc.cluster.local', rejectUnauthorized: true, ca: 'mounted-ca',
    path: '/apis/argoproj.io/v1alpha1/namespaces/argocd/applications/hupo-chat',
    headers: { Authorization: 'Bearer token-canary', Accept: 'application/json' },
    signal, method: 'GET', agent: false, maxHeaderSize: 8192 });
  assert.deepEqual(files.sort(), [['/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8'],
    ['/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8']]);
  assert.doesNotMatch(JSON.stringify(sample), /raw-secret-canary|token-canary|repoURL|namespace|10\.0\./);
});

test('DA-1 delayed transport completion beyond 750ms is UNKNOWN before its timer callback', { timeout: 2500 }, async () => {
  let destroyed = 0;
  const abort = new AbortController();
  const reader = new KubeReader({ read: async () => 'fixture', request: (_options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => { destroyed++; };
    req.end = () => queueMicrotask(() => {
      // A blocked event loop cannot run the due timer before this valid response.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
      const response = new EventEmitter();
      response.statusCode = 200; response.headers = {};
      response.destroy = () => {}; response.resume = () => {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(application())));
      response.emit('end');
    });
    return req;
  } });
  const started = performance.now();
  const sample = await reader.readApplication(abort.signal, () => now);
  assert.ok(performance.now() - started >= 750, 'the fixture must outlast the optional budget');
  assert.deepEqual(sample.application, unknown('UNAVAILABLE'));
  assert.equal(abort.signal.aborted, false, 'optional expiry must not abort mandatory work');
  assert.equal(destroyed, 1);
});

test('DA-1 semantic projection completing beyond 750ms is UNKNOWN', { timeout: 2500 }, async t => {
  const parse = JSON.parse;
  let projected = false;
  t.mock.method(JSON, 'parse', (text, ...args) => {
    const data = parse(text, ...args);
    Object.defineProperty(data.status.health, 'status', { enumerable: true, get() {
      if (!projected) {
        projected = true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
      }
      return 'Healthy';
    } });
    return data;
  });
  const reader = new KubeReader({ read: async () => 'fixture', request: wire({}) });
  const started = performance.now();
  const sample = await reader.readApplication(new AbortController().signal, () => now);
  assert.equal(projected, true, 'the delay must occur while qualifying semantic fields');
  assert.ok(performance.now() - started >= 750);
  assert.deepEqual(sample.application, unknown('UNAVAILABLE'));
});

for (const [failed, pending] of [['token', 'CA'], ['ca.crt', 'token']]) {
  test(`DA-2 ${failed} failure cannot release a still-pending ${pending} preparation`, async () => {
    let reads = 0; let requests = 0;
    const unfinished = [];
    const reader = new KubeReader({ read: path => {
      reads++;
      if (path.endsWith('/' + failed)) return Promise.reject(new Error('raw-secret-canary'));
      return new Promise(resolve => unfinished.push(() => resolve('fixture')));
    }, request: () => { requests++; assert.fail('aborted preparation cannot start HTTP'); } });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const parent = new AbortController();
        const sample = reader.readApplication(parent.signal, () => now);
        await new Promise(resolve => setImmediate(resolve));
        parent.abort();
        assert.deepEqual((await sample).application, unknown('UNAVAILABLE'));
      }
      assert.equal(reads, 2, 'a rejected peer must not reopen raw I/O while the other file is pending');
    } finally { unfinished.forEach(finish => finish()); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(requests, 0);
  });
}

test('DA-2 synchronous CA failure cannot release a pending token read', async () => {
  const unfinished = [];
  let reads = 0;
  const reader = new KubeReader({ read: path => {
    reads++;
    if (path.endsWith('/ca.crt')) throw new Error('raw-secret-canary');
    return new Promise(resolve => unfinished.push(() => resolve('fixture')));
  }, request: () => assert.fail('failed preparation cannot start HTTP') });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const parent = new AbortController();
      const sample = reader.readApplication(parent.signal, () => now);
      await new Promise(resolve => setImmediate(resolve));
      parent.abort();
      assert.deepEqual((await sample).application, unknown('UNAVAILABLE'));
    }
    assert.equal(reads, 2, 'synchronous failure still leaves the other physical read pending');
  } finally { unfinished.forEach(finish => finish()); await new Promise(resolve => setImmediate(resolve)); }
});

test('DA-2 shared publication-reserve expiry takes precedence over a late denial response', async () => {
  let time = now;
  const respond = wire({ status: 403 });
  const reader = new KubeReader({ read: async () => 'fixture', request: (options, callback) => respond(options, response => {
    time = now + 7951; callback(response);
  }) });
  const sample = await reader.readApplication(new AbortController().signal, () => time, now + 8000);
  assert.deepEqual(sample.application, unknown('UNAVAILABLE'));
});
