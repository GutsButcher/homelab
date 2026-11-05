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
      ...(component === 'prepare' ? { backoffLimit: 2 } : {}),
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
  assert.equal(plan.totals.cpuRequestsNanocores, String(9n * 100000000n));
  assert.equal(plan.totals.memoryLimitsBytes, String(9n * 128n * 1024n ** 2n));
  assert.equal(plan.totals.pvcBytes, String(5n * 1024n ** 3n));
  assert.equal(plan.totals.emptyDirBytes, String(9n * 1024n ** 2n));
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
  for (const name of ['hupo-chat-preflight', 'hupo-chat', 'hupo-chat-verification', 'hupo-chat-public']) {
    assert.ok(readme.includes(`dst=/work/apps/${name},readonly`), `${name} native read-only mount`);
  }
  assert.match(readme, /eleven pods for nine workload rows/);
  assert.match(readme, /--user 65532:65532/);
  assert.match(readme, /--pids-limit 64/);
  assert.doesNotMatch(readme, /hupo-chat\/server\/k8s\/base/);
});

test('generated rationale records computed exact budgets and snapshot limitations', () => {
  assert.equal(typeof budget.explainPlan, 'function');
  const text = budget.explainPlan(budget.buildPlan(documents(), 'a'.repeat(64)));
  assert.match(text, /900m/);
  assert.match(text, /1152Mi/);
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
  // This is source concurrency, not the separate three-copy prepare retry reservation.
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

test('inert verification Job preserves the collector and isolates the owner courier mounts', async () => {
  const { createHash } = await import('node:crypto');
  const job = JSON.parse(await readFile(new URL('../../hupo-chat-verification/base/job.yaml', import.meta.url), 'utf8'));
  assert.equal(job.metadata.namespace, 'hupo-chat');
  assert.equal(job.metadata.name, 'hupo-chat-cluster-verification');
  assert.deepEqual(Object.keys(job).sort(), ['apiVersion', 'kind', 'metadata', 'spec']);
  const pod = job.spec.template.spec;
  assert.deepEqual(pod.initContainers.map(container => container.name), ['collect', 'encrypt-owner-access']);
  assert.deepEqual(pod.containers.map(container => container.name), ['report']);
  const encryptor = pod.initContainers[1];
  const reporter = pod.containers[0];
  assert.equal(encryptor.image, pod.initContainers[0].image);
  assert.deepEqual(encryptor.env, pod.initContainers[0].env);
  assert.deepEqual(encryptor.securityContext, pod.initContainers[0].securityContext);
  assert.deepEqual(encryptor.resources, { requests: { cpu: '25m', memory: '64Mi' }, limits: { cpu: '25m', memory: '64Mi' } });
  assert.deepEqual(pod.initContainers[0].command, ['ruby', '-e',
    "Process.setrlimit(Process::RLIMIT_NPROC, 64, 64); exec('ruby', File.realpath('/opt/cluster-verify/collector.rb'), '--run-in-cluster')"]);
  assert.deepEqual(encryptor.command, ['ruby', '-e',
    "Process.setrlimit(Process::RLIMIT_NPROC, 64, 64); exec('ruby', File.realpath('/opt/hupo-chat-owner-access/encrypt.rb'), '--run-in-cluster')"]);
  assert.deepEqual(encryptor.volumeMounts, [
    { name: 'results', mountPath: '/results', readOnly: true },
    { name: 'reporter-code', mountPath: '/opt/gitops-report', readOnly: true },
    { name: 'binding', mountPath: '/run-binding', readOnly: true },
    { name: 'owner', mountPath: '/var/run/hupo-chat-owner', readOnly: true },
    { name: 'owner-code', mountPath: '/opt/hupo-chat-owner-access', readOnly: true },
    { name: 'owner-access', mountPath: '/owner-access', readOnly: false }
  ]);
  assert.deepEqual(reporter.volumeMounts.map(mount => [mount.name, mount.readOnly]),
    ['reporter-code', 'report-token', 'results', 'owner-code', 'owner-access'].map(name => [name, true]));
  assert.deepEqual(pod.volumes.find(volume => volume.name === 'owner-access'),
    { name: 'owner-access', emptyDir: { medium: 'Memory', sizeLimit: '4Ki' } });
  assert.deepEqual(pod.volumes.find(volume => volume.name === 'owner-code'), { name: 'owner-code', configMap: {
    name: 'hupo-chat-owner-access-code', defaultMode: 292, optional: false,
    items: ['wire.rb', 'encrypt.rb', 'publish.rb', 'recipient.pem', 'recipient_sha256'].map(key => ({ key, path: key })) } });
  assert.equal(pod.automountServiceAccountToken, false);
  assert.deepEqual(pod.initContainers.filter(container => container.volumeMounts.some(mount => mount.name === 'api-access')).map(container => container.name), ['collect']);
  assert.ok(!JSON.stringify(job).includes('pidsLimit'));
  // Pin the complete reviewed baseline without reading any private repository in tests.
  const baseline = structuredClone(job);
  const originalPod = baseline.spec.template.spec;
  originalPod.initContainers.pop();
  originalPod.volumes = originalPod.volumes.filter(volume => !['owner-code', 'owner-access'].includes(volume.name));
  originalPod.containers[0].volumeMounts = originalPod.containers[0].volumeMounts.filter(mount => !['owner-code', 'owner-access'].includes(mount.name));
  originalPod.containers[0].command = ['ruby', '/opt/gitops-report/reporter.rb'];
  originalPod.initContainers[0].command = ['ruby', '/opt/cluster-verify/collector.rb', '--run-in-cluster'];
  assert.equal(createHash('sha256').update(JSON.stringify(baseline)).digest('hex'),
    '2d36ca226105162d2a141a2dc89520c2e4f83f7d00c3d20e851a771a9bdb60c8');
});

test('courier publication wrapper unconditionally execs the original argument-free reporter in ensure', async () => {
  const job = JSON.parse(await readFile(new URL('../../hupo-chat-verification/base/job.yaml', import.meta.url), 'utf8'));
  // Exact source contract only. Native Ruby success/false/exception process doubles remain a separate gate.
  assert.deepEqual(job.spec.template.spec.containers[0].command, ['ruby', '-e',
    "Process.setrlimit(Process::RLIMIT_NPROC, 64, 64); begin; system('ruby', File.realpath('/opt/hupo-chat-owner-access/publish.rb'), '--run-in-cluster'); rescue StandardError; puts 'owner_access_publication_failed'; ensure; exec('ruby', File.realpath('/opt/gitops-report/reporter.rb')); end"]);
});

test('nine-workload rationale requires new native and live evidence without assuming a replacement hard cap', async () => {
  const plan = await budget.readSourcePlan(budget.parseArguments([]).source);
  assert.equal(plan.workloads.length, 9);
  const text = budget.explainPlan(plan);
  assert.match(text, /All nine reviewed workloads are budgeted concurrently/);
  assert.match(text, /hupo-chat-public\/base\/deployment.yaml/);
  assert.match(text, /Node 24/);
  assert.match(text, /fresh.*all eight checks/);
  assert.match(text, /Older seven-workload evidence does not accept this nine-workload revision/);
  assert.match(text, /not an absolute controller replacement hard cap/);
  assert.match(text, /existing nonterminal pods.*on top of.*prospective plan/);
  assert.match(text, /20Ki/);
  assert.match(text, /retained.*16Ki/);
  assert.match(text, /eleven planned pods/);
  assert.match(text, /declared-retry reservation/);
  assert.match(text, /@planner\/retry-policy.json/);
  assert.match(text, /1925m/);
  assert.match(text, /5120Mi/);
  assert.match(text, /10240Mi/);
  assert.doesNotMatch(text, /must resolve additional retry|does not silently become an eleven/);
  const prepare = JSON.parse(await readFile(new URL('../../hupo-chat/base/prepare.yaml', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries({ backoffLimit: prepare.spec.backoffLimit,
    activeDeadlineSeconds: prepare.spec.activeDeadlineSeconds,
    terminationGracePeriodSeconds: prepare.spec.template.spec.terminationGracePeriodSeconds })) {
    assert.ok(text.includes(`${key}=${value}`), `${key} must match the reviewed source`);
  }
});

test('verification README distinguishes the inert source artifact from all native and activation gates', async () => {
  const text = await readFile(new URL('../../hupo-chat-verification/README.md', import.meta.url), 'utf8');
  for (const phrase of ['INERT', 'Node 22', 'Node 24', 'UNRUN', '64-PID', 'not enforced',
    '50', '41', '44', 'RLIMIT_NPROC', 'per-UID', 'eleven planned pods', '1925m', '14336Mi',
    'backoffLimit=2', 'No Application', 'No ConfigMap data', 'all eight checks']) {
    assert.ok(text.includes(phrase), phrase);
  }
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(new URL('../../hupo-chat-verification/base', import.meta.url)), ['job.yaml']);
});
