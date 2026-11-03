import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { plan, now, inputs, optionalImport } from './helpers.mjs';
const snapshot = await optionalImport('../base/runtime/snapshot.mjs');
const pem = rootCertificates.find(text => {
  const cert = new X509Certificate(text);
  return cert.publicKey.asymmetricKeyType === 'rsa' && cert.publicKey.asymmetricKeyDetails.modulusLength >= 2048 &&
    Date.parse(cert.validFrom) < now && Date.parse(cert.validTo) > now;
});

export function provider(overrides = {}) {
  return { reader: { readInputs: async () => inputs() }, readDisk: async () => inputs().disk,
    readCert: async () => pem, clock: () => now, ...overrides };
}

test('observation exposes only allowlisted booleans, node name and public certificate', async () => {
  assert.equal(typeof snapshot.observe, 'function');
  const data = inputs();
  data.node.spec.secretCanary = 'secret-canary 10.0.0.3 private-user';
  const result = await snapshot.observe(plan, 'node01', provider({ reader: { readInputs: async () => data } }));
  assert.equal(Object.values(result.checks).every(Boolean), true);
  assert.equal(result.nodeName, 'node01');
  assert.equal(result.error, null);
  assert.doesNotMatch(JSON.stringify(result), /secret-canary|10\.0\.0\.3|private-user/);
  const failure = await snapshot.observe(plan, 'node01', provider({ reader: { readInputs: async () => {
    throw new Error('secret-canary token=hidden 10.0.0.3 private-user');
  } } }));
  assert.equal(failure.error, 'API_UNAVAILABLE');
  assert.equal(failure.checks.cpuAllocations, false);
  assert.doesNotMatch(JSON.stringify(failure), /secret-canary|token=|10\.0\.0\.3|private-user/);
  const invalid = await snapshot.observe(plan, 'node01', provider({ readCert: async () => 'PRIVATE KEY canary' }));
  assert.equal(invalid.error, 'CERT_INVALID');
  assert.equal(invalid.certificate, null);
  const noDisk = await snapshot.observe(plan, 'node01', provider({ readDisk: async () => { throw new Error('raw disk canary'); } }));
  assert.equal(noDisk.error, 'DISK_UNAVAILABLE');
});

test('cache expires results and replaces previous success immediately after a failed refresh', async () => {
  assert.equal(typeof snapshot.ReportCache, 'function');
  let time = now;
  let fails = false;
  const cache = new snapshot.ReportCache({ plan, clock: () => time, collect: async () => {
    if (fails) throw new Error('raw secret-canary 10.0.0.3 private-user');
    return { checks: Object.fromEntries(snapshot.CHECK_NAMES.map(k => [k, true])), nodeName: 'node01',
      certificate: pem, error: null, privateData: 'secret-canary' };
  } });
  assert.equal(cache.report().ok, false);
  await cache.refresh();
  assert.equal(cache.report().ok, true);
  assert.equal(cache.certificate(), new X509Certificate(pem).toString().trim() + '\n');
  assert.match(cache.report().nonce, /^[a-f0-9-]{36}$/);
  assert.equal(cache.report().revision, plan.revision);
  time += 60001;
  assert.equal(cache.report().ok, false);
  assert.equal(cache.report().error, 'STALE');
  assert.equal(cache.certificate(), null);
  await cache.refresh();
  assert.equal(cache.report().ok, true);
  fails = true;
  await cache.refresh();
  assert.equal(cache.report().ok, false);
  assert.equal(cache.report().error, 'REFRESH_FAILED');
  assert.equal(cache.certificate(), null);
  assert.doesNotMatch(JSON.stringify(cache.report()), /secret-canary|10\.0\.0\.3|private-user|privateData/);
  assert.deepEqual(Object.keys(cache.report()).sort(), ['schemaVersion', 'ok', 'checks', 'nonce', 'revision',
    'observedNode', 'observedAt', 'ageSeconds', 'fresh', 'error'].sort());
});

test('upstream metrics expiry limits an otherwise fresh cache and unknown node names never pass', async () => {
  let time = now;
  const successful = { checks: Object.fromEntries(snapshot.CHECK_NAMES.map(k => [k, true])),
    nodeName: 'node01', certificate: pem, error: null, validUntil: now + 1000 };
  const cache = new snapshot.ReportCache({ plan, clock: () => time, collect: async () => successful });
  await cache.refresh();
  assert.equal(cache.report().ok, true);
  time += 1001;
  assert.equal(cache.report().ok, false);
  assert.equal(cache.report().error, 'STALE');
  successful.nodeName = 'secret-canary 10.0.0.3 private-user';
  successful.validUntil = time + 1000;
  await cache.refresh();
  assert.equal(cache.report().observedNode, null);
  assert.equal(cache.report().ok, false);
  assert.doesNotMatch(JSON.stringify(cache.report()), /secret-canary|10\.0\.0\.3|private-user/);
});

test('one refresh runs at a time and deadline invalidates success without overlapping hung work', async () => {
  assert.equal(typeof snapshot.ReportCache, 'function');
  let calls = 0;
  let finish;
  let signal;
  const cache = new snapshot.ReportCache({ plan, clock: () => now, timeoutMs: 15, collect: async abort => {
    calls++;
    signal = abort;
    return new Promise(resolve => { finish = resolve; });
  } });
  const first = cache.refresh();
  const second = cache.refresh();
  assert.equal(first, second);
  await first;
  assert.equal(signal.aborted, true);
  assert.equal(cache.report().ok, false);
  assert.equal(cache.report().error, 'REFRESH_TIMEOUT');
  await cache.refresh();
  assert.equal(calls, 1);
  finish({ checks: Object.fromEntries(snapshot.CHECK_NAMES.map(k => [k, true])), nodeName: 'node01', certificate: pem });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.report().ok, false);
});
