import test from 'node:test';
import assert from 'node:assert/strict';
import { optionalImport } from './helpers.mjs';
const endpoint = await optionalImport('../base/runtime/endpoint.mjs');

function invoke(handler, method, url) {
  const result = {};
  handler({ method, url, headers: { host: 'untrusted.example', authorization: 'secret-canary' } }, {
    writeHead(status, headers) { result.status = status; result.headers = headers; },
    end(body) { result.body = body; }
  });
  return result;
}

test('only exact service GET/HEAD endpoints read cache; unhealthy capacity leaves HTTP healthy', () => {
  assert.equal(typeof endpoint.createHandler, 'function');
  let reads = 0;
  const cache = { report: () => { reads++; return { ok: false, error: 'CAPACITY_LOW' }; }, certificate: () => null };
  const handler = endpoint.createHandler(cache);
  const health = invoke(handler, 'GET', '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(JSON.parse(health.body), { healthy: true });
  assert.equal(reads, 0);
  const report = invoke(handler, 'GET', '/report');
  assert.equal(report.status, 200);
  assert.equal(JSON.parse(report.body).ok, false);
  assert.equal(report.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(invoke(handler, 'HEAD', '/report').body, undefined);
  assert.equal(invoke(handler, 'GET', '/certificate').status, 503);
  for (const path of ['/', '/report/', '/report?url=http://evil', '/certificate?path=/token', '/certificate.pem',
    '/%72eport', '//report', '/healthz?x', '/api/v1/secrets', 'http://evil/report']) {
    assert.equal(invoke(handler, 'GET', path).status, 404, path);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
    const response = invoke(handler, method, '/report');
    assert.equal(response.status, 405);
    assert.equal(response.headers.Allow, 'GET, HEAD');
    assert.doesNotMatch(response.body, /secret-canary|untrusted/);
  }
  cache.certificate = () => 'public-fixture\n';
  assert.equal(invoke(handler, 'GET', '/certificate').body, 'public-fixture\n');
  assert.equal(invoke(handler, 'HEAD', '/certificate').body, undefined);
});

test('certificate provenance requires the exact internal origin marker and an available certificate', () => {
  const cache = { certificate: () => 'public-fixture\n' };
  for (const certificateSource of [undefined, null, true, 'http-controller', 'kubernetes-api-service-proxy-v1\r\nInjected: yes']) {
    const handler = endpoint.createHandler(cache, { certificateSource });
    for (const method of ['GET', 'HEAD']) {
      const response = invoke(handler, method, '/certificate');
      assert.equal(response.status, 200);
      assert.equal(response.headers['X-Hupo-Certificate-Source'], undefined);
    }
  }
  const handler = endpoint.createHandler(cache, { certificateSource: 'kubernetes-api-service-proxy-v1' });
  for (const method of ['GET', 'HEAD']) {
    const response = invoke(handler, method, '/certificate');
    assert.equal(response.status, 200);
    assert.equal(response.headers['X-Hupo-Certificate-Source'], 'kubernetes-api-service-proxy-v1');
  }
  cache.certificate = () => null;
  for (const method of ['GET', 'HEAD']) {
    const response = invoke(handler, method, '/certificate');
    assert.equal(response.status, 503);
    assert.equal(response.headers['X-Hupo-Certificate-Source'], undefined);
  }
});
