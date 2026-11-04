import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { optionalImport, plan } from './helpers.mjs';
import { createHandler } from '../base/runtime/endpoint.mjs';
import { ReportCache, CHECK_NAMES } from '../base/runtime/snapshot.mjs';
import { PreflightService } from '../base/runtime/server.mjs';
import { readFile } from 'node:fs/promises';
const discovery = await optionalImport('../base/runtime/public-endpoint.mjs');

const hostname = 'unit-fixture.trycloudflare.com';
const publicUrl = 'https://' + hostname;

// This transport never opens a socket or provisions a tunnel.
function transport({ status = 200, body = JSON.stringify({ hostname }), headers = {} } = {}) {
  const calls = [];
  const state = { requestsDestroyed: 0, responsesDestroyed: 0 };
  const request = (options, callback) => {
    calls.push(options);
    const incoming = Object.assign(new EventEmitter(), { statusCode: status, headers,
      destroy() { state.responsesDestroyed++; } });
    const outgoing = Object.assign(new EventEmitter(), {
      destroy() { state.requestsDestroyed++; },
      end() { queueMicrotask(() => {
        callback(incoming);
        for (const part of Array.isArray(body) ? body : [body]) incoming.emit('data', Buffer.from(part));
        incoming.emit('end');
      }); }
    });
    return outgoing;
  };
  return { request, calls, state };
}

test('discovery reads only the fixed private metrics endpoint and returns an HTTPS hint', async () => {
  assert.equal(typeof discovery.PublicEndpointDiscovery, 'function', 'bounded discovery client is missing');
  const wire = transport();
  const client = new discovery.PublicEndpointDiscovery({ request: wire.request });
  assert.equal(client.url(), null);
  await client.refresh('https://untrusted.example/credentials');
  assert.equal(client.url(), publicUrl);
  assert.equal(wire.calls.length, 1);
  assert.deepEqual(wire.calls[0], {
    protocol: 'http:', hostname: 'hupo-chat-public.hupo-chat.svc.cluster.local',
    port: 20241, method: 'GET', path: '/quicktunnel', agent: false, maxHeaderSize: 1024,
    headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' }
  });
});

test('only one literal hostname field with a strict ASCII trycloudflare hostname is accepted', async () => {
  for (const body of [
    '{}', 'null', '[]', '"' + hostname + '"', '{"hostname":null}', '{"hostname":7}',
    '{"hostname":["' + hostname + '"]}', JSON.stringify({ hostname, secret: 'secret-canary' }),
    '{"hostname":"' + hostname + '","hostname":"' + hostname + '"}',
    '{"host\\u006eame":"' + hostname + '"}', '{"hostname":"unit-fixture\\u002etrycloudflare.com"}',
    'not-json', JSON.stringify({ hostname: '' }), JSON.stringify({ hostname: 'trycloudflare.com' }),
    ...['https://' + hostname, hostname + '/', hostname + ':443', hostname + '.evil.example',
      'eviltrycloudflare.com', 'unit.trycloudflare.com.', '.trycloudflare.com',
      '-unit.trycloudflare.com', 'unit-.trycloudflare.com', 'unit_fixture.trycloudflare.com',
      'unit..trycloudflare.com', 'é.trycloudflare.com', 'unit.trycloudflare.com\r\nInjected: secret-canary',
      'unit.trycloudflare.com\n', 'a'.repeat(64) + '.trycloudflare.com',
      ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(63), 'trycloudflare.com'].join('.')]
      .map(value => JSON.stringify({ hostname: value }))
  ]) {
    const client = new discovery.PublicEndpointDiscovery({ request: transport({ body }).request });
    await client.refresh();
    assert.equal(client.url(), null, body);
  }
  for (const value of ['a.trycloudflare.com', 'a-b.trycloudflare.com', 'a.b.trycloudflare.com',
    'a'.repeat(63) + '.trycloudflare.com']) {
    const client = new discovery.PublicEndpointDiscovery({ request: transport({ body: JSON.stringify({ hostname: value }) }).request });
    await client.refresh();
    assert.equal(client.url(), 'https://' + value);
  }
});

test('non-200 and redirects clear the hint without a second destination or response leakage', async () => {
  for (const status of [201, 204, 301, 302, 307, 308, 400, 500]) {
    const wire = transport({ status, headers: { location: 'http://erp:8080/secret-canary' } });
    const client = new discovery.PublicEndpointDiscovery({ request: wire.request });
    await client.refresh();
    assert.equal(client.url(), null, String(status));
    assert.equal(wire.calls.length, 1);
    assert.ok(wire.state.requestsDestroyed > 0);
    assert.ok(wire.state.responsesDestroyed > 0);
  }
  for (const headers of [{ 'content-encoding': 'gzip' }, { 'content-encoding': 'br' }]) {
    const client = new discovery.PublicEndpointDiscovery({ request: transport({ headers }).request });
    await client.refresh();
    assert.equal(client.url(), null);
  }
});

test('the 1024-byte body limit is enforced across chunks and announced lengths', async () => {
  const valid = JSON.stringify({ hostname });
  for (const body of [valid + ' '.repeat(1025 - Buffer.byteLength(valid)),
    [valid, ' '.repeat(1025)], [' '.repeat(1024), valid]]) {
    const wire = transport({ body });
    const client = new discovery.PublicEndpointDiscovery({ request: wire.request });
    await client.refresh();
    assert.equal(client.url(), null);
    assert.ok(wire.state.requestsDestroyed > 0);
    assert.ok(wire.state.responsesDestroyed > 0);
  }
  const wire = transport({ headers: { 'content-length': '1025' } });
  const rejected = new discovery.PublicEndpointDiscovery({ request: wire.request });
  await rejected.refresh();
  assert.equal(rejected.url(), null);
  assert.ok(wire.state.responsesDestroyed > 0);
  const boundary = new discovery.PublicEndpointDiscovery({
    request: transport({ body: valid + ' '.repeat(1024 - Buffer.byteLength(valid)) }).request });
  await boundary.refresh();
  assert.equal(boundary.url(), publicUrl);
});

test('transport failures are optional and clear any previous hint without exposing error text', async () => {
  for (const mode of ['throw', 'request-error', 'response-error', 'aborted', 'close']) {
    let calls = 0;
    const good = transport();
    const request = (options, callback) => {
      if (calls++ === 0) return good.request(options, callback);
      if (mode === 'throw') throw new Error('secret-canary');
      const outgoing = Object.assign(new EventEmitter(), { destroy() {}, end() {
        queueMicrotask(() => {
          if (mode === 'request-error') { outgoing.emit('error', new Error('secret-canary')); return; }
          const incoming = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy() {} });
          callback(incoming);
          incoming.emit(mode === 'response-error' ? 'error' : mode, new Error('secret-canary'));
        });
      } });
      return outgoing;
    };
    const client = new discovery.PublicEndpointDiscovery({ request });
    await client.refresh();
    assert.equal(client.url(), publicUrl);
    await assert.doesNotReject(client.refresh(), mode);
    assert.equal(client.url(), null, mode);
  }
});

test('one absolute 750ms deadline bounds headers and body while overlapping refreshes coalesce', async () => {
  const timers = [];
  const cancelled = [];
  let attempts = 0;
  let destroys = 0;
  let respond;
  const client = new discovery.PublicEndpointDiscovery({
    request: (_options, callback) => {
      attempts++; respond = callback;
      return Object.assign(new EventEmitter(), { end() {}, destroy() { destroys++; } });
    },
    schedule: (callback, ms) => { timers.push({ callback, ms }); return 42; },
    cancel: id => cancelled.push(id)
  });
  const first = client.refresh();
  const second = client.refresh();
  assert.equal(timers.length, 1, 'an absolute deadline must exist even before DNS or headers arrive');
  assert.ok(timers[0].ms > 0 && timers[0].ms <= 750);
  assert.equal(first, second, 'overlapping observation must use the same bounded operation');
  assert.equal(attempts, 1);
  timers[0].callback();
  await first;
  assert.equal(client.url(), null);
  assert.ok(destroys > 0);
  assert.deepEqual(cancelled, [42]);
  const late = Object.assign(new EventEmitter(), { statusCode: 200, headers: {}, destroy() { destroys++; } });
  respond(late);
  late.emit('data', Buffer.from(JSON.stringify({ hostname })));
  late.emit('end');
  assert.equal(client.url(), null, 'a response after timeout must not resurrect a hint');
});

test('discovery expires at 25 seconds, fails closed on clock reversal and clears failed observations', async () => {
  let at = 1000;
  let valid = true;
  const client = new discovery.PublicEndpointDiscovery({ clock: () => at,
    request: (options, callback) => transport({ body: valid ? JSON.stringify({ hostname }) : '{}' }).request(options, callback) });
  await client.refresh();
  at = 25999;
  assert.equal(client.url(), publicUrl);
  at = 26000;
  assert.equal(client.url(), null, 'expired metadata must not be reused');
  at = 999;
  assert.equal(client.url(), null, 'backwards clocks must not extend a hint');
  at = 30000;
  await client.refresh();
  assert.equal(client.url(), publicUrl);
  valid = false;
  await client.refresh();
  assert.equal(client.url(), null);
});

test('only existing report GET and HEAD receive the hint while JSON, root and certificate trust stay unchanged', () => {
  const cache = new ReportCache({ plan, collect: async () => ({}) });
  cache.certificate = () => 'public-pem-fixture\n';
  let reads = 0;
  const handler = createHandler(cache, { certificateSource: 'kubernetes-api-service-proxy-v1',
    publicEndpoint: { url: () => { reads++; return publicUrl; }, refresh() { assert.fail('a public request must never start discovery'); } } });
  const before = cache.report();
  const get = invoke(handler, 'GET', '/report');
  assert.equal(get.status, 200);
  assert.equal(get.headers['X-Hupo-Chat-Public-URL'], publicUrl);
  assert.deepEqual(JSON.parse(get.body), before);
  assert.deepEqual(Object.keys(JSON.parse(get.body).checks), CHECK_NAMES);
  assert.equal(get.headers['X-Hupo-Certificate-Source'], undefined);
  assert.equal(get.headers['Cache-Control'], 'no-store, max-age=0');
  const head = invoke(handler, 'HEAD', '/report');
  assert.equal(head.headers['X-Hupo-Chat-Public-URL'], publicUrl);
  assert.equal(head.headers['Content-Length'], get.headers['Content-Length']);
  assert.equal(head.body, undefined);
  assert.equal(reads, 2);
  for (const path of ['/', '/healthz', '/certificate', '/quicktunnel', '/metrics', '/report?url=http://evil', '/report/']) {
    const response = invoke(handler, 'GET', path);
    assert.equal(response.headers['X-Hupo-Chat-Public-URL'], undefined, path);
    if (path === '/certificate') {
      assert.equal(response.body, 'public-pem-fixture\n');
      assert.equal(response.headers['X-Hupo-Certificate-Source'], 'kubernetes-api-service-proxy-v1');
    } else if (path !== '/healthz') assert.equal(response.status, 404);
  }
  for (const method of ['POST', 'PUT', 'OPTIONS']) {
    const response = invoke(handler, method, '/report');
    assert.equal(response.status, 405);
    assert.equal(response.headers['X-Hupo-Chat-Public-URL'], undefined);
  }
  assert.equal(reads, 2, 'other routes and rejected methods must not read discovery');
});

test('missing, failed and unsafe hints never become headers or change report and certificate responses', () => {
  const cache = { report: () => ({ schemaVersion: 1, ok: false, error: 'CERT_UNAVAILABLE' }), certificate: () => null };
  for (const publicEndpoint of [undefined, null, {}, { url() { throw new Error('secret-canary'); } },
    ...[null, 7, {}, '', hostname, 'http://' + hostname, 'https://' + hostname + '/',
      'https://' + hostname + ':443', 'https://' + hostname + '\r\nInjected: secret-canary',
      'https://erp.hupo-chat.svc.cluster.local', 'https://eviltrycloudflare.com',
      'https://unit_fixture.trycloudflare.com', 'https://-unit.trycloudflare.com',
      'https://unit\n.trycloudflare.com', 'https://unit\r.trycloudflare.com']
      .map(value => ({ url: () => value }))]) {
    const handler = createHandler(cache, { publicEndpoint, certificateSource: 'kubernetes-api-service-proxy-v1' });
    for (const method of ['GET', 'HEAD']) {
      const report = invoke(handler, method, '/report');
      assert.equal(report.status, 200);
      assert.equal(report.headers['X-Hupo-Chat-Public-URL'], undefined);
      if (method === 'GET') assert.deepEqual(JSON.parse(report.body), cache.report());
      else assert.equal(report.body, undefined);
      const certificate = invoke(handler, method, '/certificate');
      assert.equal(certificate.status, 503);
      assert.equal(certificate.headers['X-Hupo-Certificate-Source'], undefined);
      assert.equal(certificate.headers['X-Hupo-Chat-Public-URL'], undefined);
    }
  }
});

test('runtime refreshes optional metadata independently without adding request-time I/O or certificate trust', async () => {
  let handler;
  let tick;
  let reads = 0;
  const server = { on: () => server, listen() {}, close: callback => callback() };
  const service = new PreflightService({ plan, ownNode: 'node01', publicEndpoint: {
    refresh() { reads++; return new Promise(() => {}); }, url: () => publicUrl },
    provider: { reader: { readInputs: async () => { throw new Error('unavailable'); } },
      readDisk: async () => ({}), readCert: async () => { throw new Error('certificate-unavailable'); } },
    makeServer: (_options, callback) => { handler = callback; return server; },
    schedule: callback => { tick = callback; return 1; }, cancel() {} });
  service.start();
  assert.equal(reads, 1, 'metadata discovery must start independently of the capacity budget');
  tick();
  assert.equal(reads, 2);
  await service.cache.refresh();
  const report = invoke(handler, 'GET', '/report');
  assert.equal(report.headers['X-Hupo-Chat-Public-URL'], publicUrl);
  assert.equal(JSON.parse(report.body).ok, false);
  assert.equal(JSON.parse(report.body).checks.certificate, false);
  assert.equal(invoke(handler, 'GET', '/certificate').status, 503);
  assert.equal(reads, 2);
  await service.stop();
});

test('actual ConfigMap startup includes the discovery client without introducing new API permissions', async () => {
  const source = await readFile(new URL('../base/runtime/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /publicEndpoint:\s*new PublicEndpointDiscovery\(\)/);
  const generator = JSON.parse(await readFile(new URL('../base/kustomization.yaml', import.meta.url), 'utf8'));
  assert.ok(generator.configMapGenerator[0].files.includes('runtime/public-endpoint.mjs'));
});

function invoke(handler, method, url) {
  const result = {};
  handler({ method, url, headers: { host: 'secret-canary', authorization: 'secret-canary',
    'x-hupo-chat-public-url': 'https://evil.example' } }, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body; }
  });
  return result;
}
