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
  const work = ['web', 'worker', 'postgres', 'redis', 'prepare'].map(component => ({
    apiVersion: 'apps/v1', kind: component === 'prepare' ? 'Job' : 'StatefulSet',
    metadata: { name: `hupo-chat-${component}` }, spec: { replicas: 1, template: { spec: {
      containers: [{ resources: { requests: { cpu: '100m', memory: '64Mi' },
        limits: { cpu: '1', memory: '128Mi' } } }], volumes: [{ emptyDir: { sizeLimit: '1Mi' } }] } },
    volumeClaimTemplates: component === 'postgres' ? [{ spec: { resources: { requests: { storage: '2Gi' } } } }] : [] }
  }));
  return [...work, { kind: 'PersistentVolumeClaim', metadata: { name: 'uploads' },
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

test('plan sums every workload including prepare overlap, all claims and explicit reserves', () => {
  assert.equal(typeof budget.buildPlan, 'function');
  const plan = budget.buildPlan(documents(), 'a'.repeat(64));
  assert.equal(plan.targetNode, 'node01');
  assert.equal(plan.totals.cpuRequestsNanocores, String(5n * 100000000n));
  assert.equal(plan.totals.memoryLimitsBytes, String(5n * 128n * 1024n ** 2n));
  assert.equal(plan.totals.pvcBytes, String(5n * 1024n ** 3n));
  assert.equal(plan.totals.emptyDirBytes, String(5n * 1024n ** 2n));
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
  assert.match(text, /500m/);
  assert.match(text, /640Mi/);
  assert.match(text, /Snapshot/);
  assert.match(text, /zero future/);
  assert.match(text, /node01/);
});
