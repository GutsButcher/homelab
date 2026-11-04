import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const budget = await import('../tools/build-plan.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

export function documents() {
  const kinds = { web: 'Deployment', worker: 'Deployment', postgres: 'StatefulSet', redis: 'StatefulSet',
    prepare: 'Job', 'namespace-secrets': 'Job', 'owner-bootstrap': 'Job' };
  const work = Object.entries(kinds).map(([component, kind]) => ({
    apiVersion: kind === 'Job' ? 'batch/v1' : 'apps/v1', kind,
    metadata: { name: `hupo-chat-${component}` }, spec: { replicas: 1,
      ...(kind === 'Deployment' ? { strategy: { type: 'Recreate' } } : {}), template: { spec: {
      nodeSelector: { 'kubernetes.io/hostname': 'node01' },
      containers: [{ resources: { requests: { cpu: '100m', memory: '64Mi' },
        limits: { cpu: '1', memory: '128Mi' } } }], volumes: [{ emptyDir: { sizeLimit: '1Mi' } }] } },
    volumeClaimTemplates: component === 'postgres' ? [{ spec: { resources: { requests: { storage: '2Gi' } } } }] : [] }
  }));
  return [...work, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'uploads' },
    spec: { resources: { requests: { storage: '3Gi' } } } }];
}

test('generator arguments default to the canonical sibling independently of cwd', () => {
  assert.equal(typeof budget.parseArguments, 'function');
  const moduleDirectory = dirname(fileURLToPath(new URL('../tools/build-plan.mjs', import.meta.url)));
  const source = resolve(moduleDirectory, '..', '..', 'hupo-chat', 'base');
  const cwd = process.cwd();
  try {
    process.chdir(moduleDirectory);
    assert.deepEqual(budget.parseArguments([]), { source, check: false });
    assert.deepEqual(budget.parseArguments(['--check']), { source, check: true });
  } finally { process.chdir(cwd); }
  const override = '../reviewed manifests/base';
  assert.deepEqual(budget.parseArguments([override]), { source: override, check: false });
  assert.deepEqual(budget.parseArguments([override, '--check']), { source: override, check: true });
  assert.deepEqual(budget.parseArguments(['--check', override]), { source: override, check: true });
});

test('generator arguments accept an explicit additional verification job without treating flags as paths', () => {
  assert.deepEqual(budget.parseArguments(['--additional-job', 'verifier/job.yaml', '--check', 'base']),
    { source: 'base', check: true, additionalJobPath: 'verifier/job.yaml' });
  for (const args of [['--additional-job'], ['--unknown'], ['one', 'two'], ['--check', '--check']]) {
    assert.throws(() => budget.parseArguments(args), /PLAN_INVALID/);
  }
});

test('plan sums all seven workloads concurrently, all claims and explicit reserves', () => {
  assert.equal(typeof budget.buildPlan, 'function');
  const plan = budget.buildPlan(documents(), 'a'.repeat(64));
  assert.equal(plan.targetNode, 'node01');
  assert.equal(plan.workloads.length, 7);
  assert.equal(plan.totals.cpuRequestsNanocores, String(7n * 100000000n));
  assert.equal(plan.totals.memoryLimitsBytes, String(7n * 128n * 1024n ** 2n));
  assert.equal(plan.totals.pvcBytes, String(5n * 1024n ** 3n));
  assert.equal(plan.totals.emptyDirBytes, String(7n * 1024n ** 2n));
  assert.equal(plan.reserves.diskBytes, String(10n * 1024n ** 3n));
  assert.equal(plan.reserves.memoryBytes, String(1024n ** 3n));
  assert.equal(plan.reserves.cpuNanocores, '250000000');
  const missing = documents();
  delete missing[0].spec.template.spec.containers[0].resources.limits.memory;
  assert.throws(() => budget.buildPlan(missing, 'a'.repeat(64)));
  assert.throws(() => budget.buildPlan(documents().slice(1), 'a'.repeat(64)));
  const unknown = documents();
  unknown.push({ kind: 'Deployment', metadata: { name: 'surprise' }, spec: {} });
  assert.throws(() => budget.buildPlan(unknown, 'a'.repeat(64)));
});

test('plan provenance identifies the canonical homelab source, not a private mirror', async () => {
  const source = 'homelab/apps/hupo-chat/base (JSON manifests)';
  const plan = budget.buildPlan(documents(), 'a'.repeat(64));
  assert.equal(plan.source, source);
  assert.ok(budget.explainPlan(plan).includes(`Source: \`${source}\``));
  const generated = JSON.parse(await readFile(new URL('../base/plan.json', import.meta.url), 'utf8'));
  assert.equal(generated.source, source);
  const rationale = await readFile(new URL('../PLAN.md', import.meta.url), 'utf8');
  assert.ok(rationale.includes(`Source: \`${source}\``));
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('node tools/build-plan.mjs --check'));
  assert.ok(readme.includes('node tools/build-plan.mjs ../hupo-chat/base --check'));
  assert.doesNotMatch(readme, /hupo-chat\/server\/k8s\/base/);
});

test('generated rationale records computed exact budgets and snapshot limitations', () => {
  assert.equal(typeof budget.explainPlan, 'function');
  const text = budget.explainPlan(budget.buildPlan(documents(), 'a'.repeat(64)));
  assert.match(text, /700m/);
  assert.match(text, /896Mi/);
  assert.match(text, /Snapshot/);
  assert.match(text, /zero future/);
  assert.match(text, /node01/);
  assert.match(text, /Source budget only/);
  assert.match(text, /all seven canonical workloads concurrently/);
  assert.match(text, /Verification job is not included/);
  assert.match(text, /1Gi reserve does not prove/);
  assert.match(text, /Every regular and init container.*explicit positive memory limit/);
  assert.match(text, /even with a positive pod-level memory cap/);
});

test('workload output order is deterministic for the same source documents', () => {
  assert.deepEqual(budget.buildPlan(documents().reverse(), 'a'.repeat(64)),
    budget.buildPlan(documents(), 'a'.repeat(64)));
});

test('every workload must retain its reviewed kind', () => {
  for (let index = 0; index < 7; index++) {
    const changed = documents();
    changed[index].kind = changed[index].kind === 'Job' ? 'Deployment' : 'Job';
    assert.throws(() => budget.buildPlan(changed, 'a'.repeat(64)), /PLAN_INVALID/, changed[index].metadata.name);
  }
});

test('every workload must have exactly one concurrent replica', () => {
  for (let index = 0; index < 7; index++) {
    for (const replicas of [null, 0, 2, -1, 1.5, '1']) {
      const changed = documents();
      changed[index].spec[changed[index].kind === 'Job' ? 'parallelism' : 'replicas'] = replicas;
      assert.throws(() => budget.buildPlan(changed, 'a'.repeat(64)), /PLAN_INVALID/);
    }
  }
});

test('deployments cannot add unbudgeted rolling-update surge pods', () => {
  for (const strategy of [undefined, { type: 'RollingUpdate' }]) {
    const changed = documents();
    changed[0].spec.strategy = strategy;
    assert.throws(() => budget.buildPlan(changed, 'a'.repeat(64)), /PLAN_INVALID/);
  }
});

test('all storage declarations must have positive explicit bounds', () => {
  for (const value of [undefined, '0', '0Mi']) {
    for (const target of ['pvc', 'template', 'emptyDir']) {
      const changed = documents();
      if (target === 'pvc') changed.at(-1).spec.resources.requests.storage = value;
      if (target === 'template') changed[2].spec.volumeClaimTemplates[0].spec.resources.requests.storage = value;
      if (target === 'emptyDir') changed[0].spec.template.spec.volumes[0].emptyDir.sizeLimit = value;
      assert.throws(() => budget.buildPlan(changed, 'a'.repeat(64)), /(?:PLAN|QUANTITY)_INVALID/, target);
    }
  }
});

test('generic ephemeral volume claim templates are included in storage totals', () => {
  const changed = documents();
  changed[5].spec.template.spec.volumes.push({ name: 'scratch-claim', ephemeral: {
    volumeClaimTemplate: { spec: { resources: { requests: { storage: '1Gi' } } } } } });
  const plan = budget.buildPlan(changed, 'a'.repeat(64));
  assert.equal(plan.totals.pvcBytes, String(6n * 1024n ** 3n));
  assert.equal(plan.workloads.find(row => row.name === 'hupo-chat-namespace-secrets').storageBytes, String(1024n ** 3n));
});

test('every workload must be pinned to node01 without a conflicting nodeName', () => {
  for (let index = 0; index < 7; index++) {
    for (const pin of [undefined, {}, { 'kubernetes.io/hostname': 'node02' }]) {
      const changed = documents();
      changed[index].spec.template.spec.nodeSelector = pin;
      assert.throws(() => budget.buildPlan(changed, 'a'.repeat(64)), /PLAN_INVALID/);
    }
    const changed = documents();
    changed[index].spec.template.spec.nodeName = 'node02';
    assert.throws(() => budget.buildPlan(changed, 'a'.repeat(64)), /PLAN_INVALID/);
  }
});
