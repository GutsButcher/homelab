import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as budget from '../tools/build-plan.mjs';
import { evaluate } from '../base/runtime/capacity.mjs';
import { inputs, now } from './helpers.mjs';

// Synthetic graphs and public source copies are parser fixtures, not runtime acceptance evidence.
class PlanFixture {
  static async copyCanonical(t) {
    const root = await mkdtemp(join(tmpdir(), 'preflight-canonical-plan-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const fixture = new PlanFixture(root);
    await cp(new URL('../../hupo-chat/base', import.meta.url), fixture.source, { recursive: true });
    return fixture;
  }

  static async create(t) {
    const root = await mkdtemp(join(tmpdir(), 'preflight-plan-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const fixture = new PlanFixture(root);
    await fixture.kustomization('', ['steady', 'bootstrap']);
    const steady = ['web', 'worker', 'postgres', 'redis', 'prepare'];
    await fixture.kustomization('steady', steady.map((_, index) => `${index}.json`));
    for (const [index, name] of steady.entries()) await fixture.put(`steady/${index}.json`, fixture.workload(name));
    await fixture.kustomization('bootstrap', ['owner.yaml', 'nested']);
    await fixture.put('bootstrap/owner.yaml', fixture.workload('owner-bootstrap'));
    await fixture.kustomization('bootstrap/nested', ['generator.yaml', 'claim.yaml']);
    await fixture.put('bootstrap/nested/generator.yaml', fixture.workload('namespace-secrets'));
    await fixture.put('bootstrap/nested/claim.yaml', { apiVersion: 'v1', kind: 'PersistentVolumeClaim',
      metadata: { name: 'uploads' }, spec: { resources: { requests: { storage: '3Gi' } } } });
    return fixture;
  }

  constructor(root) { this.root = root; this.source = join(root, 'base'); }

  workload(name) {
    const kind = ['prepare', 'namespace-secrets', 'owner-bootstrap'].includes(name) ? 'Job' :
      ['postgres', 'redis'].includes(name) ? 'StatefulSet' : 'Deployment';
    return { apiVersion: kind === 'Job' ? 'batch/v1' : 'apps/v1', kind, metadata: { name: `hupo-chat-${name}` },
      spec: { ...(kind === 'Job' ? { parallelism: 1 } : { replicas: 1 }),
        ...(kind === 'Deployment' ? { strategy: { type: 'Recreate' } } : {}),
        template: { spec: { nodeSelector: { 'kubernetes.io/hostname': 'node01' },
          containers: [{ name: 'app', resources: { requests: { cpu: '100m', memory: '64Mi' },
            limits: { cpu: '1', memory: '128Mi' } } }], volumes: [{ name: 'tmp', emptyDir: { sizeLimit: '1Mi' } }] } },
        ...(name === 'postgres' ? { volumeClaimTemplates: [{ metadata: { name: 'data' },
          spec: { resources: { requests: { storage: '2Gi' } } } }] } : {}) } };
  }

  async put(path, value) {
    const target = join(this.source, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  }

  async get(path) { return JSON.parse(await readFile(join(this.source, path), 'utf8')); }

  async kustomization(path, resources, extra = {}) {
    await this.put(join(path, 'kustomization.yaml'), { apiVersion: 'kustomize.config.k8s.io/v1beta1',
      kind: 'Kustomization', namespace: 'hupo-chat', resources, ...extra });
  }
}

test('source plan follows the recursive Kustomization graph rather than filename guesses', async t => {
  const fixture = await PlanFixture.create(t);
  await fixture.put('unused.yaml', 'this deliberately is not JSON or a reachable resource');
  assert.equal(typeof budget.readSourcePlan, 'function');
  const plan = await budget.readSourcePlan(fixture.source);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.workloads.length, 7);
  assert.equal(plan.totals.cpuRequestsNanocores, '700000000');
  assert.equal(plan.totals.memoryLimitsBytes, String(7n * 128n * 1024n ** 2n));
  assert.equal(plan.totals.pvcBytes, String(5n * 1024n ** 3n));
  assert.equal(plan.totals.emptyDirBytes, String(7n * 1024n ** 2n));
});

test('resource references cannot escape the selected tree or use remote paths', async t => {
  const fixture = await PlanFixture.create(t);
  await writeFile(join(fixture.root, 'outside.yaml'), JSON.stringify({ apiVersion: 'v1', kind: 'ConfigMap',
    metadata: { name: 'outside' } }));
  for (const reference of ['../outside.yaml', 'https://example.invalid/workload.yaml',
    'git::https://example.invalid/repository', 'C:/outside.yaml', '\\\\server\\share\\job.yaml', 'steady/../steady/0.json']) {
    await fixture.kustomization('', ['steady', 'bootstrap', reference]);
    await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/, reference);
  }
});

test('resource references cannot follow a directory junction outside the selected tree', async t => {
  const fixture = await PlanFixture.create(t);
  const original = await budget.readSourcePlan(fixture.source);
  const outside = join(fixture.root, 'outside');
  await mkdir(outside);
  const nested = { apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization', resources: [] };
  await fixture.put('inside/kustomization.yaml', nested);
  await writeFile(join(outside, 'kustomization.yaml'), JSON.stringify(nested, null, 2) + '\n');
  await symlink(join(fixture.source, 'inside'), join(fixture.source, 'contained'), 'junction');
  await fixture.kustomization('', ['steady', 'bootstrap', 'contained']);
  const contained = await budget.readSourcePlan(fixture.source);
  assert.equal(contained.workloads.length, 7);
  assert.deepEqual(contained.workloads, original.workloads);
  assert.deepEqual(contained.totals, original.totals);
  await symlink(outside, join(fixture.source, 'escaped'), 'junction');
  await fixture.kustomization('', ['steady', 'bootstrap', 'escaped']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('duplicate resource files fail even when they do not contain workloads', async t => {
  const fixture = await PlanFixture.create(t);
  await fixture.put('config.yaml', { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'config' } });
  await fixture.kustomization('', ['steady', 'bootstrap', 'config.yaml', './config.yaml']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('duplicate object bindings fail across different paths and inherited namespaces', async t => {
  const fixture = await PlanFixture.create(t);
  await fixture.put('first.yaml', { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'same' } });
  await fixture.put('second.yaml', { apiVersion: 'v1', kind: 'ConfigMap',
    metadata: { name: 'same', namespace: 'hupo-chat' } });
  await fixture.kustomization('', ['steady', 'bootstrap', 'first.yaml', 'second.yaml']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('reachable unknown workload kinds cannot be silently excluded', async t => {
  const fixture = await PlanFixture.create(t);
  for (const kind of ['ReplicaSet', 'ReplicationController', 'CustomWorkload', 'List']) {
    await fixture.put('stray.yaml', { apiVersion: 'apps/v1', kind, metadata: { name: 'stray' },
      items: [fixture.workload('web')] });
    await fixture.kustomization('', ['steady', 'bootstrap', 'stray.yaml']);
    await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/, kind);
  }
});

test('unsupported Kustomize transformations cannot silently change the resource budget', async t => {
  const fixture = await PlanFixture.create(t);
  for (const field of ['patches', 'replicas', 'components', 'bases', 'generators', 'transformers', 'helmCharts', 'replacements']) {
    await fixture.kustomization('', ['steady', 'bootstrap'], { [field]: [] });
    await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/, field);
  }
});

test('generator file references obey the same source containment boundary', async t => {
  const fixture = await PlanFixture.create(t);
  await writeFile(join(fixture.root, 'outside.rb'), 'puts "outside"\n');
  await fixture.kustomization('', ['steady', 'bootstrap'], {
    configMapGenerator: [{ name: 'code', files: ['../outside.rb'] }] });
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('a directory resolves one standard Kustomization filename without ambiguous alternatives', async t => {
  const fixture = await PlanFixture.create(t);
  const initial = join(fixture.source, 'bootstrap/nested/kustomization.yaml');
  const alternate = join(fixture.source, 'bootstrap/nested/Kustomization');
  await rename(initial, alternate);
  assert.equal((await budget.readSourcePlan(fixture.source)).workloads.length, 7);
  await fixture.kustomization('bootstrap/nested', []);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('source collection rejects a manifest larger than one MiB', async t => {
  const fixture = await PlanFixture.create(t);
  await fixture.put('oversized.yaml', { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'oversized' },
    data: { payload: 'x'.repeat(1024 ** 2) } });
  await fixture.kustomization('', ['steady', 'bootstrap', 'oversized.yaml']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('source collection rejects more than 256 source files', async t => {
  const fixture = await PlanFixture.create(t);
  const files = [];
  for (let index = 0; index < 256; index++) {
    const path = `config/${index}.json`;
    files.push(path);
    await fixture.put(path, { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: `config-${index}` } });
  }
  await fixture.kustomization('', ['steady', 'bootstrap', ...files]);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('source collection bounds total bytes across generator files', async t => {
  const fixture = await PlanFixture.create(t);
  const files = [];
  for (let index = 0; index < 17; index++) {
    const path = `code/${index}.rb`;
    files.push(path);
    await fixture.put(path, 'x'.repeat(512 * 1024));
  }
  await fixture.kustomization('', ['steady', 'bootstrap'], { configMapGenerator: [{ name: 'code', files }] });
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('an explicit verification job contributes its real resources and an eighth pod slot', async t => {
  const fixture = await PlanFixture.create(t);
  const original = await budget.readSourcePlan(fixture.source);
  const verifier = fixture.workload('namespace-secrets');
  verifier.metadata.name = 'hupo-chat-cluster-verification';
  verifier.spec.template.spec.containers[0].resources = {
    requests: { cpu: '25m', memory: '64Mi' }, limits: { cpu: '200m', memory: '192Mi' } };
  verifier.spec.template.spec.volumes = [{ name: 'result', emptyDir: { sizeLimit: '16Ki', medium: 'Memory' } }];
  const path = join(fixture.root, 'verification-job.yaml');
  await writeFile(path, JSON.stringify(verifier));
  const plan = await budget.readSourcePlan(fixture.source, path);
  assert.equal(plan.workloads.length, 8);
  assert.equal(plan.workloads.reduce((sum, row) => sum + row.replicas, 0), 8);
  const runtimeInput = inputs();
  runtimeInput.node.status.allocatable.pods = '7';
  assert.equal(evaluate(runtimeInput, plan, 'node01', now).podSlots, false);
  runtimeInput.node.status.allocatable.pods = '8';
  assert.equal(evaluate(runtimeInput, plan, 'node01', now).podSlots, true);
  assert.equal(plan.totals.cpuRequestsNanocores, '725000000');
  assert.equal(plan.totals.memoryLimitsBytes, String((7n * 128n + 192n) * 1024n ** 2n));
  assert.equal(plan.totals.emptyDirBytes, String(7n * 1024n ** 2n + 16n * 1024n));
  assert.notEqual(plan.revision, original.revision);
  for (const invalid of [undefined, 'hupo-chat-another-job']) {
    verifier.metadata.name = invalid;
    await writeFile(path, JSON.stringify(verifier));
    await assert.rejects(budget.readSourcePlan(fixture.source, path), /^Error: PLAN_INVALID$/);
  }
  await assert.rejects(budget.readSourcePlan(fixture.source, path + '.missing'), /^Error: PLAN_INVALID$/);
});

// Collector-shaped fixture only: never read private collector source or execute this Job.
function verificationJob() {
  return { apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name: 'hupo-chat-cluster-verification', namespace: 'hupo-chat-preflight' },
    spec: { parallelism: 1, completions: 1, backoffLimit: 0, template: { spec: {
      nodeSelector: { 'kubernetes.io/hostname': 'node01' }, restartPolicy: 'Never',
      serviceAccountName: 'hupo-chat-cluster-verification',
      containers: [{ name: 'collector', image: `registry.example.invalid/collector@sha256:${'a'.repeat(64)}`,
        command: ['/bin/true'], resources: { requests: { cpu: '25m', memory: '64Mi' },
          limits: { cpu: '200m', memory: '192Mi' } }, volumeMounts: [{ name: 'result', mountPath: '/result' }] }],
      volumes: [{ name: 'result', emptyDir: { sizeLimit: '16Ki', medium: 'Memory' } }] } } } };
}

function verificationTarget(job, placement) {
  const pod = job.spec.template.spec;
  if (placement === 'verifier') return pod.containers[0];
  const extra = { ...structuredClone(pod.containers[0]), name: 'helper' };
  if (placement === 'regular sidecar') pod.containers.push(extra);
  else {
    pod.initContainers = [extra];
    if (placement === 'restartable init') extra.restartPolicy = 'Always';
  }
  return extra;
}

for (const placement of ['verifier', 'regular sidecar', 'regular init', 'restartable init']) {
  test(`canonical source parser rejects zero memory limits in ${placement}`, async t => {
    const fixture = await PlanFixture.copyCanonical(t);
    const original = await budget.readSourcePlan(fixture.source);
    assert.equal(original.workloads.length, 7);
    const path = join(fixture.root, 'verification-job.yaml');
    for (const podCap of [undefined, '512Mi']) {
      const job = verificationJob();
      const target = verificationTarget(job, placement);
      if (podCap !== undefined) job.spec.template.spec.resources = { limits: { memory: podCap } };
      await writeFile(path, JSON.stringify(job));
      const bounded = await budget.readSourcePlan(fixture.source, path);
      assert.equal(bounded.workloads.length, 8);
      const row = bounded.workloads.find(row => row.name === job.metadata.name);
      const expectedMi = podCap ? 512n : ['regular sidecar', 'restartable init'].includes(placement) ? 384n : 192n;
      assert.equal(row.memoryLimitsBytes, String(expectedMi * 1024n ** 2n));
      target.resources.requests.memory = '0';
      for (const zero of ['0', '0Mi', '+0', '.0Gi', '0e3', 0]) {
        target.resources.limits.memory = zero;
        await writeFile(path, JSON.stringify(job));
        await assert.rejects(budget.readSourcePlan(fixture.source, path), /^Error: PLAN_INVALID$/,
          `${placement}: ${JSON.stringify(zero)}, pod cap ${podCap ?? 'none'}`);
      }
    }
  });
}

test('canonical source parser keeps rejecting missing empty and malformed container memory limits', async t => {
  const fixture = await PlanFixture.copyCanonical(t);
  const path = join(fixture.root, 'verification-job.yaml');
  for (const placement of ['verifier', 'regular sidecar', 'regular init', 'restartable init']) {
    const job = verificationJob();
    const target = verificationTarget(job, placement);
    await writeFile(path, JSON.stringify(job));
    assert.equal((await budget.readSourcePlan(fixture.source, path)).workloads.length, 8);
    target.resources.requests.memory = '0';
    for (const invalid of [undefined, '', 'not-memory', '-1Mi', 'Infinity']) {
      target.resources.limits.memory = invalid;
      await writeFile(path, JSON.stringify(job));
      await assert.rejects(budget.readSourcePlan(fixture.source, path), /^Error: PLAN_INVALID$/,
        `${placement}: ${String(invalid)}`);
    }
  }
});

test('canonical source parser permits zero requests and CPU limits with positive container memory caps', async t => {
  const fixture = await PlanFixture.copyCanonical(t);
  const path = join(fixture.root, 'verification-job.yaml');
  const job = verificationJob();
  const target = job.spec.template.spec.containers[0];
  target.resources.requests = { cpu: '0', memory: '0' };
  target.resources.limits.cpu = '0';
  await writeFile(path, JSON.stringify(job));
  const plan = await budget.readSourcePlan(fixture.source, path);
  const row = plan.workloads.find(row => row.name === job.metadata.name);
  assert.equal(plan.workloads.length, 8);
  assert.equal(row.cpuRequestsNanocores, '0');
  assert.equal(row.memoryRequestsBytes, '0');
  assert.equal(row.memoryLimitsBytes, String(192n * 1024n ** 2n));
});

test('default CLI check automatically includes a materialized public verification job', async t => {
  const fixture = await PlanFixture.create(t);
  const app = join(fixture.root, 'apps/hupo-chat-preflight');
  const canonical = join(fixture.root, 'apps/hupo-chat/base');
  const script = join(app, 'tools/build-plan.mjs');
  await mkdir(join(app, 'tools'), { recursive: true });
  await mkdir(join(app, 'base/runtime'), { recursive: true });
  await mkdir(dirname(canonical), { recursive: true });
  await rename(fixture.source, canonical);
  await copyFile(new URL('../tools/build-plan.mjs', import.meta.url), script);
  await copyFile(new URL('../base/runtime/resources.mjs', import.meta.url), join(app, 'base/runtime/resources.mjs'));
  const isolated = await import(pathToFileURL(script).href);
  assert.equal((await isolated.readSourcePlan(canonical)).workloads.length, 7);
  const publicJob = join(fixture.root, 'apps/hupo-chat-verification/base/job.yaml');
  await mkdir(dirname(publicJob), { recursive: true });
  const verifier = fixture.workload('namespace-secrets');
  verifier.metadata.name = 'hupo-chat-cluster-verification';
  await writeFile(publicJob, JSON.stringify(verifier));
  const generated = await isolated.generate(canonical);
  assert.equal(generated.workloads.length, 8);
  const run = promisify(execFile);
  const result = await run(process.execPath, [script, '--check'], { cwd: fixture.root, timeout: 10000 });
  assert.equal(JSON.parse(result.stdout).revision, generated.revision);
  verifier.spec.template.spec.containers[0].resources.limits.memory = '256Mi';
  await writeFile(publicJob, JSON.stringify(verifier));
  await assert.rejects(run(process.execPath, [script, '--check'], { cwd: fixture.root, timeout: 10000 }),
    error => error.code === 1 && /\r?\nError: PLAN_CHANGED\r?\n/.test(error.stderr));
});

test('directory-reference cycles fail without recurring indefinitely', async t => {
  const fixture = await PlanFixture.create(t);
  await fixture.kustomization('bootstrap/nested', ['.']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
  await fixture.kustomization('bootstrap/nested', ['generator.yaml', 'claim.yaml']);
  await symlink(fixture.source, join(fixture.source, 'recursive'), 'junction');
  await fixture.kustomization('', ['steady', 'bootstrap', 'recursive']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('a missing integrated job cannot be replaced by a stray nested workload', async t => {
  const fixture = await PlanFixture.create(t);
  await fixture.kustomization('bootstrap/nested', ['claim.yaml']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
  const stray = fixture.workload('namespace-secrets');
  stray.metadata.name = 'hupo-chat-stray';
  await fixture.put('bootstrap/nested/generator.yaml', stray);
  await fixture.kustomization('bootstrap/nested', ['generator.yaml', 'claim.yaml']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
  await fixture.put('bootstrap/nested/generator.yaml', fixture.workload('namespace-secrets'));
  await fixture.kustomization('bootstrap', ['nested']);
  await assert.rejects(budget.readSourcePlan(fixture.source), /^Error: PLAN_INVALID$/);
});

test('source revision binds sorted paths and exact raw workflow and PVC bytes', async t => {
  const fixture = await PlanFixture.create(t);
  const plan = await budget.readSourcePlan(fixture.source);
  const paths = ['kustomization.yaml', 'steady/kustomization.yaml', 'bootstrap/kustomization.yaml',
    'bootstrap/nested/kustomization.yaml', 'bootstrap/owner.yaml', 'bootstrap/nested/generator.yaml',
    'bootstrap/nested/claim.yaml', ...Array.from({ length: 5 }, (_, index) => `steady/${index}.json`)];
  const expected = createHash('sha256');
  for (const path of paths.sort()) expected.update(path + '\0').update(await readFile(join(fixture.source, path))).update('\0');
  assert.equal(plan.revision, expected.digest('hex'));
  const independent = await PlanFixture.create(t);
  assert.deepEqual(await budget.readSourcePlan(independent.source), plan);
  await fixture.put('bootstrap/nested/generator.yaml', (await readFile(join(fixture.source, 'bootstrap/nested/generator.yaml'), 'utf8')) + '\n');
  const changed = await budget.readSourcePlan(fixture.source);
  assert.notEqual(changed.revision, plan.revision);
  assert.deepEqual(changed.totals, plan.totals);
  const claim = await fixture.get('bootstrap/nested/claim.yaml');
  claim.spec.resources.requests.storage = '4Gi';
  await fixture.put('bootstrap/nested/claim.yaml', claim);
  const resized = await budget.readSourcePlan(fixture.source);
  assert.notEqual(resized.revision, changed.revision);
  assert.equal(resized.totals.pvcBytes, String(6n * 1024n ** 3n));
});

test('source reports never copy configuration, secret values, identities or annotations', async t => {
  const fixture = await PlanFixture.create(t);
  const privateMarker = 'untrusted-owner@example.invalid-secret-canary';
  const generator = await fixture.get('bootstrap/nested/generator.yaml');
  generator.metadata.annotations = { private: privateMarker };
  generator.spec.template.spec.containers[0].env = [{ name: 'PRIVATE', value: privateMarker }];
  await fixture.put('bootstrap/nested/generator.yaml', generator);
  await fixture.put('config.yaml', { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'private-config' }, data: { privateMarker } });
  await fixture.put('secret.yaml', { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'private-secret' }, stringData: { privateMarker } });
  await fixture.put('runtime/code.rb', `# ${privateMarker}\n`);
  await fixture.kustomization('', ['steady', 'bootstrap', 'config.yaml', 'secret.yaml'], {
    configMapGenerator: [{ name: 'runtime-code', files: ['runtime/code.rb'] }] });
  const plan = await budget.readSourcePlan(fixture.source);
  const encoded = JSON.stringify(plan) + budget.explainPlan(plan);
  assert.ok(!encoded.includes(privateMarker));
  assert.ok(!encoded.includes(fixture.root));
  assert.doesNotMatch(encoded, /private-config|private-secret|"annotations"|PRIVATE/);
  await fixture.put('runtime/code.rb', `# ${privateMarker}\n\n`);
  const recoded = await budget.readSourcePlan(fixture.source);
  assert.notEqual(recoded.revision, plan.revision);
  assert.deepEqual(recoded.totals, plan.totals);
});

test('canonical source exposes the integrated namespace-generation and owner-bootstrap jobs', async () => {
  const plan = await budget.readSourcePlan(budget.parseArguments([]).source);
  for (const name of ['hupo-chat-namespace-secrets', 'hupo-chat-owner-bootstrap']) {
    const row = plan.workloads.find(workload => workload.name === name);
    assert.ok(row, name);
    assert.equal(row.kind, 'Job');
    assert.equal(row.replicas, 1);
    assert.ok(BigInt(row.memoryLimitsBytes) > 0n);
  }
});
