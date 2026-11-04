import test from 'node:test';
import assert from 'node:assert/strict';
import { optionalImport, now } from './helpers.mjs';
import { application, known, unknown, pin } from './diagnostic-fixtures.mjs';
const app = await optionalImport('../base/runtime/application.mjs');

const identityCases = {
  kind: data => { data.kind = 'Job'; }, namespace: data => { data.metadata.namespace = 'wrong'; },
  name: data => { data.metadata.name = 'wrong'; }, apiVersion: data => { data.apiVersion = 'v1'; },
  project: data => { data.spec.project = 'wrong'; }, repo: data => { data.spec.source.repoURL += '/'; },
  path: data => { data.spec.source.path = 'apps/hupo-chat/base'; }, pin: data => { data.spec.source.targetRevision = 'main'; },
  destination: data => { data.spec.destination.namespace = 'wrong'; }, server: data => { data.spec.destination.server += '/'; },
  sources: data => { data.spec.sources = [data.spec.source]; }, renderer: data => { data.spec.source.directory = {}; },
  deletion: data => { data.metadata.deletionTimestamp = new Date(now).toISOString(); },
  comparedDestination: data => { data.status.sync.comparedTo.destination.namespace = 'wrong'; },
  comparedSources: data => { data.status.sync.comparedTo.sources = [data.spec.source]; },
  comparedTo: data => { data.status.sync.comparedTo.source.targetRevision = 'a'.repeat(40); }
};
for (const [name, mutate] of Object.entries(identityCases)) {
  test(`Argo ${name} identity mismatch is UNKNOWN, not reported unhealthy`, () => {
    const data = application(); mutate(data);
    assert.deepEqual(app.applicationSample(data, now).application, unknown('IDENTITY_MISMATCH'));
  });
}

test('Argo malformed or unknown statuses and unbounded timestamps are UNKNOWN with null observations', () => {
  for (const mutate of [
    data => { delete data.metadata.uid; }, data => { data.metadata.resourceVersion = ''; },
    data => { data.status.health.status = 'raw-secret-canary'; }, data => { data.status.sync.status = 'raw-secret-canary'; },
    data => { data.status.sync.revision = 'main'; }, data => { delete data.status.sync.comparedTo; },
    data => { data.status.reconciledAt = 'today'; }, data => { data.status.reconciledAt = '2026-02-30T00:00:00Z'; }
  ]) {
    const data = application(); mutate(data);
    assert.deepEqual(app.applicationSample(data, now).application, unknown('MALFORMED'));
  }
  for (const value of [null, {}, [], 'raw-secret-canary']) {
    assert.deepEqual(app.applicationSample(value, now).application, unknown('MALFORMED'));
  }
  for (const field of ['health', 'sync']) {
    const data = application(); data.status[field].status = 'Unknown';
    assert.deepEqual(app.applicationSample(data, now).application, unknown('STATUS_UNKNOWN'));
  }
  for (const skew of [-60001, 5001]) {
    const data = application(); data.status.reconciledAt = new Date(now + skew).toISOString();
    assert.deepEqual(app.applicationSample(data, now).application, unknown('STALE'));
  }
});

test('Argo valid reported nonhealthy and unsynced statuses remain qualified observations, not admission', () => {
  for (const status of ['Progressing', 'Degraded', 'Missing', 'Suspended']) {
    const data = application(); data.status.health.status = status;
    assert.deepEqual(app.applicationSample(data, now).application,
      { ...known, reportedHealthy: false, reason: 'REPORTED_UNHEALTHY' });
  }
  for (const [status, revision] of [['OutOfSync', pin], ['Synced', 'a'.repeat(40)]]) {
    const data = application(); Object.assign(data.status.sync, { status, revision });
    assert.deepEqual(app.applicationSample(data, now).application, { ...known, syncedExpected: false, reason: 'NOT_SYNCED' });
  }
});

test('Argo pending operations and Running or Terminating phases are never idle', () => {
  const pending = application(); pending.operation = { sync: { revision: pin } };
  assert.deepEqual(app.applicationSample(pending, now).application, { ...known, idle: false, reason: 'BUSY' });
  for (const phase of ['Running', 'Terminating']) {
    const data = application(); data.status.operationState = operationState(phase);
    assert.deepEqual(app.applicationSample(data, now).application, { ...known, idle: false, reason: 'BUSY' });
  }
  for (const phase of ['Succeeded', 'Failed', 'Error']) {
    const data = application(); data.status.operationState = operationState(phase);
    assert.deepEqual(app.applicationSample(data, now).application, known);
  }
});

test('Argo operation revision and timestamp validation cannot be bypassed by Healthy and Synced', () => {
  const cases = [
    ['MALFORMED', data => { data.operation = {}; }],
    ['MALFORMED', data => { data.status.operationState = {}; }],
    ['IDENTITY_MISMATCH', data => { data.operation = { sync: { revision: 'a'.repeat(40) } }; }],
    ['IDENTITY_MISMATCH', data => { data.status.operationState.syncResult.revision = 'a'.repeat(40); }],
    ['IDENTITY_MISMATCH', data => { data.status.operationState.operation.sync.revision = 'a'.repeat(40); }],
    ['MALFORMED', data => { data.status.operationState.phase = 'Pending'; }],
    ['MALFORMED', data => { delete data.status.operationState.finishedAt; }],
    ['MALFORMED', data => { data.status.operationState.finishedAt = new Date(now - 200000).toISOString(); }],
    ['STALE', data => { data.status.operationState.finishedAt = new Date(now + 5001).toISOString(); }]
  ];
  for (const [reason, mutate] of cases) {
    const data = application(); data.status.operationState = operationState('Succeeded'); mutate(data);
    assert.deepEqual(app.applicationSample(data, now).application, unknown(reason));
  }
});

test('Argo bracket requires matching UID, resourceVersion and every relevant state field', () => {
  assert.equal(typeof app.bracketApplication, 'function');
  const first = app.applicationSample(application(), now);
  assert.deepEqual(app.bracketApplication(first, first, now), first);
  for (const mutate of [
    data => { data.metadata.uid += '-new'; }, data => { data.metadata.resourceVersion = '43'; },
    data => { data.status.health.status = 'Degraded'; }, data => { data.status.sync.status = 'OutOfSync'; },
    data => { data.status.reconciledAt = new Date(now - 1).toISOString(); },
    data => { data.operation = { sync: { revision: pin } }; },
    data => { data.status.operationState = operationState('Succeeded'); }
  ]) {
    const data = application(); mutate(data);
    assert.deepEqual(app.bracketApplication(first, app.applicationSample(data, now), now).application, unknown('CHANGING'));
  }
  assert.deepEqual(app.bracketApplication(first, first, now + 60001).application, unknown('STALE'));
  assert.deepEqual(app.bracketApplication(first, app.unknownApplicationSample('DENIED'), now).application, unknown('DENIED'));
  assert.deepEqual(app.bracketApplication(app.unknownApplicationSample('MISSING'), first, now).application, unknown('MISSING'));
});

function operationState(phase) {
  const terminal = ['Succeeded', 'Failed', 'Error'].includes(phase);
  return { phase, startedAt: new Date(now - 120000).toISOString(),
    ...(terminal ? { finishedAt: new Date(now - 60000).toISOString() } : {}),
    operation: { sync: { revision: pin } }, syncResult: { revision: pin } };
}

test('Argo observation qualifies only the literal pinned Application and never assumes observedGeneration', () => {
  assert.equal(typeof app.applicationSample, 'function');
  const data = application();
  data.metadata.annotations = { canary: 'raw-secret-canary 10.0.0.3' };
  data.status.health.message = 'raw-secret-canary';
  const sample = app.applicationSample(data, now);
  assert.deepEqual(sample.application, known);
  assert.match(sample.signature, /^[a-f0-9]{64}$/);
  assert.equal(sample.validUntil, now + 60000);
  assert.doesNotMatch(JSON.stringify(sample), /raw-secret-canary|10\.0\.0\.3|repoURL|uid|resourceVersion/);
  data.status.observedGeneration = 'not-an-Application-contract';
  assert.deepEqual(app.applicationSample(data, now), sample);
});

const sourceOverrides = {
  alternate: {
    drySource: { repoURL: 'https://example.invalid/alternate.git', path: 'different/path', targetRevision: 'main' },
    syncSource: { targetBranch: 'hydrated', path: 'different/output' }
  },
  malformed: {}, null: null, false: false,
};
for (const [name, override] of Object.entries(sourceOverrides)) {
  test(`DA-3 Argo sourceHydrator ${name} override is UNKNOWN with null observations`, () => {
    assert.deepEqual(app.applicationSample(application(), now).application, known);
    const data = application();
    data.spec.sourceHydrator = override;
    const sample = app.applicationSample(data, now);
    assert.deepEqual(sample.application, unknown('IDENTITY_MISMATCH'));
    assert.equal(sample.signature, null);
    assert.equal(sample.validUntil, null);
    assert.doesNotMatch(JSON.stringify(sample), /example\.invalid|different\/path|hydrated/);
  });
}

