import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { KubeReader } from '../base/runtime/upstream.mjs';
import { plan, now, inputs, optionalImport } from './helpers.mjs';
const runtime = await optionalImport('../base/runtime/server.mjs');

test('runtime wires bounded HTTP and scheduled cache refresh without starting a local server in tests', async () => {
  assert.equal(typeof runtime.PreflightService, 'function');
  const events = [];
  let handler;
  const fake = { on: (name, callback) => { events.push(['on', name]); return fake; },
    listen: (...args) => events.push(['listen', ...args]), close: callback => { events.push(['close']); callback?.(); } };
  const service = new runtime.PreflightService({ plan, ownNode: 'node01', provider: {
    reader: { readInputs: async () => inputs() }, readDisk: async () => inputs().disk, readCert: async () => 'invalid', clock: () => now },
    makeServer: (options, callback) => { assert.equal(options.requestTimeout, 5000); handler = callback; return fake; },
    schedule: (callback, ms) => { events.push(['schedule', ms]); return 123; },
    cancel: id => events.push(['cancel', id]) });
  assert.equal(events.some(e => e[0] === 'listen'), false);
  service.start();
  assert.equal(events.some(e => e[0] === 'schedule' && e[1] === 20000), true);
  assert.equal(events.some(e => e[0] === 'listen' && e[1] === 8080 && e[2] === '0.0.0.0'), true);
  await service.cache.refresh();
  const response = {};
  handler({ method: 'GET', url: '/report' }, { writeHead: status => { response.status = status; }, end: body => { response.body = body; } });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).ok, false);
  assert.equal(JSON.parse(response.body).error, 'CERT_INVALID');
  await service.stop();
  assert.equal(events.some(e => e[0] === 'cancel' && e[1] === 123), true);
});

test('runtime default reads the certificate through KubeReader instead of direct HTTP', async t => {
  const pem = publicPem(Date.now());
  let certificateReads = 0;
  let certificateFails = false;
  let socketAttempts = 0;
  t.mock.method(KubeReader.prototype, 'readInputs', async () => { throw new Error('fixture unavailable'); });
  t.mock.method(KubeReader.prototype, 'readCertificate', async signal => {
    certificateReads++;
    assert.ok(signal instanceof AbortSignal);
    if (certificateFails) throw new Error('raw secret-canary');
    return pem;
  });
  const blockNetwork = () => { socketAttempts++; throw new Error('sockets are forbidden in this test'); };
  t.mock.method(http, 'request', blockNetwork);
  t.mock.method(https, 'request', blockNetwork);
  syncBuiltinESMExports();
  try {
    const { service, invoke } = serviceFixture();
    assert.equal(invoke('GET', '/certificate').status, 503);
    assert.equal(invoke('GET', '/certificate').headers['X-Hupo-Certificate-Source'], undefined);
    await service.cache.refresh();
    assert.equal(certificateReads, 1);
    assert.equal(socketAttempts, 0);
    const response = invoke('GET', '/certificate');
    assert.equal(response.status, 200);
    assert.equal(response.body, new X509Certificate(pem).toString().trim() + '\n');
    assert.equal(response.headers['X-Hupo-Certificate-Source'], 'kubernetes-api-service-proxy-v1');
    const head = invoke('HEAD', '/certificate');
    assert.equal(head.status, 200);
    assert.equal(head.headers['X-Hupo-Certificate-Source'], response.headers['X-Hupo-Certificate-Source']);
    assert.equal(head.headers['Content-Length'], response.headers['Content-Length']);
    assert.equal(head.body, undefined);
    for (const path of ['/report', '/healthz', '/certificate?source=kubernetes-api-service-proxy-v1']) {
      assert.equal(invoke('GET', path).headers['X-Hupo-Certificate-Source'], undefined);
    }
    certificateFails = true;
    await service.cache.refresh();
    assert.equal(certificateReads, 2);
    assert.equal(socketAttempts, 0, 'API failure must not fall back to the direct controller');
    for (const method of ['GET', 'HEAD']) {
      const failed = invoke(method, '/certificate');
      assert.equal(failed.status, 503);
      assert.equal(failed.headers['X-Hupo-Certificate-Source'], undefined);
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('injected providers never inherit the default certificate provenance', async () => {
  const pem = publicPem(now);
  for (const certificateSource of [undefined, true, 'http-controller', 'untrusted\r\nHeader: canary']) {
    const { service, invoke } = serviceFixture({ reader: { readInputs: async () => inputs() },
      readDisk: async () => inputs().disk, readCert: async () => pem, clock: () => now, certificateSource });
    await service.cache.refresh();
    for (const method of ['GET', 'HEAD']) {
      const response = invoke(method, '/certificate');
      assert.equal(response.status, 200);
      assert.equal(response.headers['X-Hupo-Certificate-Source'], undefined);
    }
  }
});

test('certificate provenance is cleared on invalid, failed and stale certificate observations', async () => {
  const pem = publicPem(now);
  let mode = 'valid';
  let time = now;
  const { service, invoke } = serviceFixture({ reader: { readInputs: async () => inputs() },
    readDisk: async () => inputs().disk, certificateSource: 'kubernetes-api-service-proxy-v1', clock: () => time,
    readCert: async () => {
      if (mode === 'failed') throw new Error('raw secret-canary');
      return mode === 'invalid' ? 'raw secret-canary' : pem.replace(/\n/g, '\r\n') + ' \t\r\n';
    } });
  for (const next of ['valid', 'invalid', 'valid', 'failed', 'valid', 'stale']) {
    mode = next;
    if (mode === 'stale') time += 60001;
    else await service.cache.refresh();
    for (const method of ['GET', 'HEAD']) {
      const response = invoke(method, '/certificate');
      assert.equal(response.status, mode === 'valid' ? 200 : 503);
      assert.equal(response.headers['X-Hupo-Certificate-Source'], mode === 'valid' ? 'kubernetes-api-service-proxy-v1' : undefined);
      if (method === 'HEAD') assert.equal(response.body, undefined);
      else if (mode === 'valid') assert.equal(response.body, new X509Certificate(pem).toString().trim() + '\n');
      else assert.deepEqual(JSON.parse(response.body), { error: 'CERT_UNAVAILABLE' });
    }
    assert.doesNotMatch(invoke('GET', '/report').body, /secret-canary|certificateSource|kubernetes-api-service-proxy-v1/);
  }
});

test('certificate provenance disappears at certificate expiry even inside cache freshness', async () => {
  const pem = publicPem(now);
  let time = Date.parse(new X509Certificate(pem).validTo) - 1;
  const { service, invoke } = serviceFixture({ reader: { readInputs: async () => { throw new Error('fixture unavailable'); } },
    readDisk: async () => inputs().disk, readCert: async () => pem, clock: () => time,
    certificateSource: 'kubernetes-api-service-proxy-v1' });
  await service.cache.refresh();
  assert.equal(invoke('GET', '/certificate').headers['X-Hupo-Certificate-Source'], 'kubernetes-api-service-proxy-v1');
  time++;
  for (const method of ['GET', 'HEAD']) {
    const response = invoke(method, '/certificate');
    assert.equal(response.status, 503);
    assert.equal(response.headers['X-Hupo-Certificate-Source'], undefined);
  }
});

function publicPem(at) {
  const pem = rootCertificates.find(text => {
    const cert = new X509Certificate(text);
    return cert.publicKey.asymmetricKeyType === 'rsa' && cert.publicKey.asymmetricKeyDetails.modulusLength >= 2048 &&
      cert.publicKey.asymmetricKeyDetails.modulusLength <= 8192 && cert.publicKey.asymmetricKeyDetails.publicExponent >= 65537n &&
      Date.parse(cert.validFrom) <= at && at < Date.parse(cert.validTo);
  });
  assert.ok(pem, 'offline root corpus must contain a valid strong RSA fixture');
  return pem;
}

function serviceFixture(provider) {
  let handler;
  const server = { on: () => server };
  const service = new runtime.PreflightService({ plan, ownNode: 'node01', provider,
    makeServer: (_options, callback) => { handler = callback; return server; } });
  return { service, invoke(method, url) {
    const result = {};
    handler({ method, url, headers: { 'x-hupo-certificate-source': 'kubernetes-api-service-proxy-v1' } }, {
      writeHead: (status, headers) => { result.status = status; result.headers = headers; },
      end: body => { result.body = body; }
    });
    return result;
  } };
}
