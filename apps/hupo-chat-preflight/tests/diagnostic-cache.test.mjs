import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportCache, CHECK_NAMES, observe } from '../base/runtime/snapshot.mjs';
import { createHandler } from '../base/runtime/endpoint.mjs';
import { applicationSample, unknownApplicationSample } from '../base/runtime/application.mjs';
import { stateDiagnosticHeaders } from '../base/runtime/diagnostic.mjs';
import { PreflightService } from '../base/runtime/server.mjs';
import { KubeReader } from '../base/runtime/upstream.mjs';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { inputs, now, plan } from './helpers.mjs';
import { application, known, unknown, provider, invoke } from './diagnostic-fixtures.mjs';

const producerSha256 = 'a'.repeat(64);
const headerName = 'X-Hupo-State-Diagnostic';
function decode(response) {
  const encoded = response.headers[headerName];
  assert.equal(typeof encoded, 'string', 'observation header is missing');
  assert.ok(Buffer.byteLength(encoded) <= 2048);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const text = Buffer.from(encoded, 'base64url').toString('utf8');
  assert.match(text, /^[\x20-\x7e]+$/);
  return JSON.parse(text);
}

test('service wires the computed producer through the existing cached report handler without listener or request I/O', async () => {
  let handler; let calls = 0;
  const server = { on: () => server };
  const service = new PreflightService({ plan, producerSha256, ownNode: 'node01',
    provider: provider({ readApplication: async () => { calls++; return applicationSample(application(), now); } }),
    makeServer: (_options, callback) => { handler = callback; return server; } });
  await service.cache.refresh();
  assert.equal(calls, 2);
  const first = invoke(handler);
  assert.equal(decode(first).producerSha256, producerSha256);
  const head = invoke(handler, 'HEAD');
  assert.equal(head.headers[headerName], first.headers[headerName]);
  assert.equal(head.headers['Content-Length'], first.headers['Content-Length']);
  assert.equal(head.body, undefined);
  assert.equal(calls, 2);
});

test('unknown optional Argo results preserve the mandatory capacity snapshot and reset prior hints', async () => {
  let mode = 'known'; let calls = 0;
  const upstream = provider({ readApplication: async () => {
    calls++;
    if (mode === 'throw') throw new Error('raw-secret-canary');
    return mode === 'known' ? applicationSample(application(), now) : unknownApplicationSample(mode);
  } });
  const baseline = await observe(plan, 'node01', provider(), new AbortController().signal);
  const cache = new ReportCache({ plan, producerSha256, clock: () => now,
    collect: signal => observe(plan, 'node01', upstream, signal) });
  for (mode of ['known', 'DENIED', 'MISSING', 'MALFORMED', 'STALE', 'CHANGING', 'throw']) {
    await cache.refresh();
    const report = cache.report(); const hint = decode(invoke(createHandler(cache)));
    assert.deepEqual(report.checks, baseline.checks);
    assert.equal(report.error, baseline.error);
    assert.equal(report.ok, true);
    assert.deepEqual(hint.capacity, { state: 'KNOWN', fullPolicyDeficitMi: 0 });
    assert.deepEqual(hint.application, mode === 'known' ? known : unknown(mode === 'throw' ? 'UNAVAILABLE' : mode));
  }
  assert.equal(calls, 14);
});

test('stale reports and failed refreshes cannot reuse diagnostic data or old nonce bindings', async () => {
  let time = now; let fails = false;
  const result = await observe(plan, 'node01', provider({ readApplication: async () => applicationSample(application(), now) }));
  const cache = new ReportCache({ plan, producerSha256, clock: () => time, collect: async () => {
    if (fails) throw new Error('raw-secret-canary'); return result;
  } });
  const handler = createHandler(cache);
  assert.equal(invoke(handler).headers[headerName], undefined);
  await cache.refresh();
  const oldReport = cache.report(); decode(invoke(handler));
  time += 60001;
  assert.equal(invoke(handler).headers[headerName], undefined);
  assert.equal(cache.report().error, 'STALE');
  time = now; fails = true; await cache.refresh();
  assert.equal(cache.report().error, 'REFRESH_FAILED');
  assert.equal(invoke(handler).headers[headerName], undefined);
  assert.notEqual(cache.report().nonce, oldReport.nonce);
  assert.deepEqual(cache.diagnostic(oldReport), {});
});

test('Argo reconciliation expiry downgrades only the optional status while the report remains fresh', async () => {
  let time = now;
  const data = application(); data.status.reconciledAt = new Date(now - 59000).toISOString();
  const upstream = provider({ readApplication: async () => applicationSample(data, time) });
  const cache = new ReportCache({ plan, producerSha256, clock: () => time,
    collect: signal => observe(plan, 'node01', upstream, signal) });
  await cache.refresh();
  assert.deepEqual(decode(invoke(createHandler(cache))).application, known);
  time += 1001;
  assert.equal(cache.report().ok, true);
  assert.deepEqual(decode(invoke(createHandler(cache))).application, unknown('STALE'));
});

test('refresh timeout clears diagnostics, retains the abort lock and rejects late success before a newer observation', async () => {
  const result = await observe(plan, 'node01', provider({ readApplication: async () => applicationSample(application(), now) }));
  let mode = 'good'; let calls = 0; let finish; let signal;
  const cache = new ReportCache({ plan, producerSha256, timeoutMs: 15, clock: () => now, collect: async abort => {
    calls++; signal = abort;
    if (mode === 'hung') return new Promise(resolve => { finish = resolve; });
    return result;
  } });
  await cache.refresh(); const first = cache.report(); decode(invoke(createHandler(cache)));
  mode = 'hung'; const active = cache.refresh(); assert.equal(cache.refresh(), active);
  await active;
  assert.equal(signal.aborted, true);
  assert.equal(cache.report().error, 'REFRESH_TIMEOUT');
  assert.equal(invoke(createHandler(cache)).headers[headerName], undefined);
  await cache.refresh(); assert.equal(calls, 2);
  finish(result); await new Promise(resolve => setImmediate(resolve));
  assert.equal(cache.report().error, 'REFRESH_TIMEOUT');
  mode = 'good'; await cache.refresh();
  assert.equal(calls, 3); assert.notEqual(cache.report().nonce, first.nonce);
  assert.equal(decode(invoke(createHandler(cache))).nonce, cache.report().nonce);
  assert.deepEqual(cache.diagnostic(first), {});
});

test('only report GET and HEAD add diagnostics; exact existing headers and all other endpoint bodies stay unchanged', async () => {
  let calls = 0;
  const upstream = provider({ readApplication: async () => { calls++; return applicationSample(application(), now); } });
  const cache = new ReportCache({ plan, producerSha256, clock: () => now, collect: signal => observe(plan, 'node01', upstream, signal) });
  await cache.refresh();
  const options = { certificateSource: 'kubernetes-api-service-proxy-v1', publicEndpoint: { url: () => 'https://unit-fixture.trycloudflare.com' } };
  const handler = createHandler(cache, options);
  const legacy = createHandler({ report: () => cache.report(), certificate: () => cache.certificate() }, options);
  for (const url of ['/report', '/', '/report?x=1', '/report/', '/%72eport', '/healthz', '/certificate', '/certificate?x=1']) {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const actual = invoke(handler, method, url); const expected = invoke(legacy, method, url);
      if (url === '/report' && ['GET', 'HEAD'].includes(method)) {
        decode(actual); delete actual.headers[headerName];
      } else assert.equal(actual.headers[headerName], undefined);
      assert.deepEqual(actual, expected, method + ' ' + url);
    }
  }
  assert.equal(calls, 2);
});

test('header projection strips raw fields, coerced bindings and inconsistent optional state rather than reflecting input', async () => {
  const result = await observe(plan, 'node01', provider());
  const cache = new ReportCache({ plan, producerSha256, clock: () => now, collect: async () => result });
  await cache.refresh(); const report = cache.report();
  const state = { capacity: { state: 'KNOWN', fullPolicyDeficitMi: 1, raw: 'raw-secret-canary' },
    application: { ...known, raw: 'raw-secret-canary' }, applicationValidUntil: now + 60000, phaseAdmissionVerified: true, raw: 'raw-secret-canary' };
  assert.deepEqual(decode({ headers: stateDiagnosticHeaders(report, state, producerSha256, now) }).application, known);
  assert.doesNotMatch(Buffer.from(stateDiagnosticHeaders(report, state, producerSha256, now)[headerName], 'base64url').toString(), /raw-secret-canary/);
  assert.deepEqual(stateDiagnosticHeaders(report, state, [producerSha256], now), {});
  assert.deepEqual(stateDiagnosticHeaders({ ...report, revision: [plan.revision] }, state, producerSha256, now), {});
  assert.deepEqual(stateDiagnosticHeaders({ ...report, nonce: [report.nonce] }, state, producerSha256, now), {});
  state.application.reason = 'DENIED';
  assert.deepEqual(decode({ headers: stateDiagnosticHeaders(report, state, producerSha256, now) }).application, unknown('MALFORMED'));
});

test('optional second bracket read cannot spend the final shared refresh budget or corrupt completed capacity', async () => {
  let time = now; let calls = 0;
  const upstream = provider({ readApplication: async () => { calls++; return applicationSample(application(), time); },
    readInputs: async () => { time = now + 7501; return inputs(); } });
  upstream.clock = () => time;
  const cache = new ReportCache({ plan, producerSha256, clock: () => time,
    collect: (signal, deadline) => {
      assert.equal(deadline, now + 8000, 'all observations must share the attempt-start deadline');
      return observe(plan, 'node01', upstream, signal, deadline);
    } });
  await cache.refresh();
  assert.equal(cache.report().ok, true);
  assert.equal(calls, 1, 'no optional request may start without its bounded completion budget');
  assert.deepEqual(decode(invoke(createHandler(cache))).application, unknown('UNAVAILABLE'));
});

test('the absolute attempt deadline rejects completion even before a delayed timeout callback runs', async () => {
  let time = now;
  const result = await observe(plan, 'node01', provider());
  const cache = new ReportCache({ plan, producerSha256, clock: () => time, collect: async () => {
    time = now + 8001; return result;
  } });
  await cache.refresh();
  assert.equal(cache.report().error, 'REFRESH_TIMEOUT');
  assert.equal(cache.report().ok, false);
  assert.equal(invoke(createHandler(cache)).headers[headerName], undefined);
});

test('a cached diagnostic cannot be rebound to another policy, node or observation time', async () => {
  const result = await observe(plan, 'node01', provider());
  const cache = new ReportCache({ plan, producerSha256, clock: () => now, collect: async () => result });
  await cache.refresh(); const report = cache.report();
  for (const change of [{ revision: 'b'.repeat(64) }, { observedNode: null }, { observedAt: new Date(now - 1).toISOString() }]) {
    assert.deepEqual(cache.diagnostic({ ...report, ...change }), {});
  }
});

test('diagnostic header binds a full-policy deficit and bracketed Argo status without changing eight-check FAIL body', async () => {
  const data = inputs();
  data.node.status.allocatable.memory = String(BigInt(plan.totals.memoryLimitsBytes) + BigInt(plan.reserves.memoryBytes) + 2n * 1024n ** 3n - 1n);
  data.node.metadata.annotations = { canary: 'raw-secret-canary 10.0.0.3 pod-private-name' };
  const events = []; const signals = [];
  const upstream = provider({
    async readApplication(signal) { events.push('application'); signals.push(signal); return applicationSample(application(), now); },
    async readInputs(_node, signal) { events.push('capacity'); signals.push(signal); return data; }
  });
  const cache = new ReportCache({ plan, producerSha256, clock: () => now,
    collect: signal => observe(plan, 'node01', upstream, signal) });
  await cache.refresh();
  assert.deepEqual(events, ['application', 'capacity', 'application']);
  assert.ok(signals.every(signal => signal === signals[0]));
  const result = invoke(createHandler(cache));
  const report = cache.report();
  const checks = Object.fromEntries(CHECK_NAMES.map(name => [name, name !== 'memoryUsage']));
  assert.equal(result.body, JSON.stringify({ schemaVersion: 1, ok: false, checks, nonce: report.nonce,
    revision: plan.revision, observedNode: 'node01', observedAt: new Date(now).toISOString(), ageSeconds: 0, fresh: true, error: 'CAPACITY_LOW' }) + '\n');
  const diagnostic = decode(result);
  assert.deepEqual(diagnostic, { schemaVersion: 1, producerSha256, policyRevision: report.revision, nonce: report.nonce,
    observedAt: report.observedAt, observedNode: report.observedNode, capacity: { state: 'KNOWN', fullPolicyDeficitMi: 1 },
    application: known, phaseAdmissionVerified: false });
  assert.doesNotMatch(JSON.stringify(diagnostic) + result.body, /raw-secret-canary|10\.0\.0\.3|pod-private-name|allocatable|usage|repoURL|BEGIN CERTIFICATE/);
});

test('DA-2 asynchronous second credential preparation preserves completed mandatory inputs near eight seconds', { timeout: 12000 }, async () => {
  const started = performance.now();
  const clock = () => now + performance.now() - started;
  let preparations = 0; let requests = 0; let mandatoryReady = false; let sharedSignal;
  const pending = [];
  const reader = new KubeReader({ read: path => {
    if (path.endsWith('/token')) preparations++;
    if (preparations !== 2) return Promise.resolve('fixture');
    assert.equal(mandatoryReady, true, 'only the second optional preparation is delayed');
    const read = delay(1000, 'fixture'); pending.push(read); return read;
  }, request: (_options, callback) => {
    requests++;
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.headers = {};
      response.destroy = () => {}; response.resume = () => {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(application()))); response.emit('end');
    });
    return req;
  } });
  const upstream = provider({ readApplication: (...args) => reader.readApplication(...args), readInputs: async () => {
    await delay(7112); mandatoryReady = true; return inputs();
  } });
  upstream.clock = clock;
  const cache = new ReportCache({ plan, producerSha256, clock, collect: (signal, deadline) => {
    sharedSignal = signal; return observe(plan, 'node01', upstream, signal, deadline);
  } });
  try {
    await cache.refresh();
    assert.equal(preparations, 2);
    assert.equal(cache.report().error, null, 'optional preparation must not consume the mandatory publication reserve');
    assert.equal(cache.report().ok, true);
    assert.deepEqual(cache.report().checks, Object.fromEntries(CHECK_NAMES.map(name => [name, true])));
    assert.deepEqual(decode(invoke(createHandler(cache))).application, unknown('UNAVAILABLE'));
    assert.equal(sharedSignal.aborted, false, 'only owned optional work expires');
  } finally { await Promise.all(pending); }
  assert.equal(requests, 1, 'late second preparation must never start HTTP');
});

test('DA-2 repeated refreshes coalesce pending raw credential reads and discard late settlement', { timeout: 7000 }, async () => {
  const unfinished = [];
  let reads = 0; let pending = 0; let peak = 0; let requests = 0; let stalled = true;
  const reader = new KubeReader({ read: () => {
    reads++;
    if (!stalled) return Promise.resolve('fixture');
    pending++; peak = Math.max(peak, pending);
    return new Promise(resolve => unfinished.push(() => { pending--; resolve('fixture'); }));
  }, request: (_options, callback) => {
    requests++;
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.headers = {};
      response.destroy = () => {}; response.resume = () => {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(application()))); response.emit('end');
    });
    return req;
  } });
  const upstream = provider({ readApplication: (...args) => reader.readApplication(...args) });
  const cache = new ReportCache({ plan, producerSha256, clock: () => now,
    collect: (signal, deadline) => observe(plan, 'node01', upstream, signal, deadline) });
  let expired;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await cache.refresh();
      assert.equal(cache.report().ok, true);
      assert.deepEqual(decode(invoke(createHandler(cache))).application, unknown('UNAVAILABLE'));
    }
    expired = cache.report();
    assert.equal(reads, 2, 'all four optional calls must share one pending token/CA pair');
    assert.equal(peak, 2, 'no overlapping raw preparation may accumulate across refreshes');
  } finally { unfinished.forEach(finish => finish()); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(pending, 0);
  assert.equal(requests, 0, 'expired subscribers must not start HTTP when raw reads settle');
  assert.deepEqual(decode(invoke(createHandler(cache))).application, unknown('UNAVAILABLE'));
  stalled = false;
  await cache.refresh();
  assert.equal(requests, 2);
  assert.deepEqual(decode(invoke(createHandler(cache))).application, known);
  assert.notEqual(cache.report().nonce, expired.nonce);
  assert.deepEqual(cache.diagnostic(expired), {}, 'late preparation cannot bind an earlier snapshot to new hints');
});
