import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { podResources, quantity } from '../base/runtime/resources.mjs';

const components = ['web', 'worker', 'postgres', 'redis', 'prepare', 'namespace-secrets', 'owner-bootstrap'];
const reviewedKinds = { web: 'Deployment', worker: 'Deployment', postgres: 'StatefulSet', redis: 'StatefulSet',
  prepare: 'Job', 'namespace-secrets': 'Job', 'owner-bootstrap': 'Job', 'cluster-verification': 'Job' };
const verificationName = 'hupo-chat-cluster-verification';
const workloadKinds = ['Deployment', 'StatefulSet', 'Job', 'DaemonSet', 'CronJob', 'Pod'];
const resourceApis = { Deployment: 'apps/v1', StatefulSet: 'apps/v1', Job: 'batch/v1',
  Namespace: 'v1', ServiceAccount: 'v1', Service: 'v1', ConfigMap: 'v1', Secret: 'v1', PersistentVolumeClaim: 'v1',
  Role: 'rbac.authorization.k8s.io/v1', RoleBinding: 'rbac.authorization.k8s.io/v1',
  ClusterRole: 'rbac.authorization.k8s.io/v1', ClusterRoleBinding: 'rbac.authorization.k8s.io/v1',
  NetworkPolicy: 'networking.k8s.io/v1', SealedSecret: 'bitnami.com/v1alpha1' };
const clusterKinds = ['Namespace', 'ClusterRole', 'ClusterRoleBinding'];
const kustomizationKeys = ['apiVersion', 'kind', 'namespace', 'resources', 'configMapGenerator', 'generatorOptions'];
const defaultSource = fileURLToPath(new URL('../../hupo-chat/base', import.meta.url));

export function parseArguments(args) {
  let source;
  let check = false;
  let additionalJobPath;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--check' && !check) check = true;
    else if (arg === '--additional-job' && additionalJobPath === undefined && args[index + 1] && !args[index + 1].startsWith('-')) {
      additionalJobPath = args[++index];
    } else if (source === undefined && arg && !arg.startsWith('-')) source = arg;
    else throw new Error('PLAN_INVALID');
  }
  return { source: source || defaultSource, check,
    ...(additionalJobPath === undefined ? {} : { additionalJobPath }) };
}

export function buildPlan(documents, revision) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('PLAN_INVALID');
  validateDocuments(documents);
  const workloads = documents.filter(doc => workloadKinds.includes(doc.kind));
  const names = workloads.map(doc => doc.metadata?.name).sort();
  const expected = components.map(c => `hupo-chat-${c}`);
  if (names.includes(verificationName)) expected.push(verificationName);
  if (JSON.stringify(names) !== JSON.stringify(expected.sort())) throw new Error('PLAN_INVALID');
  const rows = workloads.map(workloadBudget).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const sum = key => rows.reduce((total, row) => total + BigInt(row[key]), 0n);
  const pvcBytes = documents.filter(doc => doc.kind === 'PersistentVolumeClaim').reduce((total, doc) =>
    total + positiveStorage(doc.spec?.resources?.requests?.storage), sum('storageBytes'));
  return { schemaVersion: 1, revision, targetNode: 'node01',
    source: 'homelab/apps/hupo-chat/base (JSON manifests)', workloads: rows,
    totals: { cpuRequestsNanocores: String(sum('cpuRequestsNanocores')),
      memoryRequestsBytes: String(sum('memoryRequestsBytes')), memoryLimitsBytes: String(sum('memoryLimitsBytes')),
      pvcBytes: String(pvcBytes), emptyDirBytes: String(sum('emptyDirBytes')) },
    reserves: { cpuNanocores: String(quantity('250m', 'cpu')), memoryBytes: String(quantity('1Gi', 'memory')),
      diskBytes: String(quantity('10Gi', 'storage')), freeInodes: '1024' } };
}

export function explainPlan(plan) {
  const t = plan.totals;
  const r = plan.reserves;
  const mi = value => `${BigInt(value) / 1024n ** 2n}Mi`;
  const disk = BigInt(t.pvcBytes) + BigInt(t.emptyDirBytes) + BigInt(r.diskBytes);
  const verification = plan.workloads.some(row => row.name === verificationName) ?
    'The additional verification Job is included as a concurrent row, including its CPU, memory, storage and pod slot; it does not consume the safety reserves. ' :
    '**Verification job is not included.** Materialize the public verification Job, regenerate this plan and refresh runtime evidence before using it for deployment. The 1Gi reserve does not prove verification CPU or pod-slot headroom. ';
  const rows = plan.workloads.map(w => `| ${w.name} | ${w.replicas} | ${BigInt(w.cpuRequestsNanocores) / 1000000n}m | ${mi(w.memoryRequestsBytes)} | ${mi(w.memoryLimitsBytes)} |`).join('\n');
  return `# Generated source budget\n\n` +
    `Source: \`${plan.source}\`; relevant source SHA-256: \`${plan.revision}\`.\n\n` +
    `**Source budget only.** No live capacity result or deployment acceptance is established by generation. An older five-workload snapshot does not accept this revision; promote the matching preflight source and obtain a fresh runtime snapshot.\n\n` +
    `| Workload | Concurrent replicas | CPU requests | Memory requests | Memory limits |\n` +
    `| --- | ---: | ---: | ---: | ---: |\n${rows}\n\n` +
    `Totals: **${BigInt(t.cpuRequestsNanocores) / 1000000n}m CPU requests**, **${mi(t.memoryRequestsBytes)} memory requests**, **${mi(t.memoryLimitsBytes)} memory limits**.\n\n` +
    `Declared app PVCs: ${t.pvcBytes} bytes; declared emptyDir bounds: ${t.emptyDirBytes} bytes; explicit disk reserve: ${r.diskBytes} bytes. ` +
    `Required available bytes on the own local-path PVC filesystem: **${disk}** (${(Number(disk) / 1024 ** 3).toFixed(3)} GiB).\n\n` +
    `CPU reserve: ${BigInt(r.cpuNanocores) / 1000000n}m. Memory reserve: ${mi(r.memoryBytes)}. Free-inode reserve: ${r.freeInodes}.\n\n` +
    `- Snapshot candidate: **${plan.targetNode}** (documented worker). This is a chosen target, not a live observation; deployment selector, exact-node RBAC and runtime allowlist agree. ` +
    `The public observedNode is populated only after an actual matching API observation.\n` +
    `- Count all seven canonical workloads concurrently, including namespace generation, prepare and owner bootstrap. Sync waves and hook ordering are not phase-exclusive capacity assumptions. No existing workload is subtracted. ` +
    `The runtime pod-slot check counts every replica in the workload rows (${plan.workloads.reduce((sum, row) => sum + row.replicas, 0)} planned pods).\n` +
    `- ${verification}Canonical generation and \`--check\` automatically include \`homelab/apps/hupo-chat-verification/base/job.yaml\` when present. ` +
    `An explicit \`--additional-job PATH\` supports a reviewed source override, not production acceptance.\n` +
    `- Both existing CPU requests and actual CPU usage, plus planned CPU requests and reserve, must fit allocatable CPU. CPU limits may still contend later.\n` +
    `- Existing memory requests plus planned requests and reserve must fit; max(existing requests, actual memory usage) plus all planned memory limits and reserve must also fit.\n` +
    `- Every regular and init container, including restartable init sidecars, must declare an explicit positive memory limit. A zero limit is unbounded, not a zero-byte cap. ` +
    `This fixed seven/eight-workload source policy rejects zero container limits even with a positive pod-level memory cap; CPU and request semantics are unchanged.\n` +
    `- Every declared standalone PVC, per-replica volumeClaimTemplate and generic ephemeral claim template is included, plus positive emptyDir size limits and a separate image/log/growth reserve. ` +
    `Local-path sizes are not filesystem quotas or physical reservations. statfs reads only the dedicated read-only /probe-storage mount; it writes no test files.\n` +
    `- Exclude only terminal pods and other nodes. Include scheduled Pending/Unknown pods, regular init peaks, ordered restartable-init sidecars, pod overhead, pod-level requests and enacted/in-flight resize allocations.\n` +
    `- Follow local JSON Kustomization resources recursively, not a directory-wide filename scan. Remote references, parent traversal, symlink escapes, cycles, duplicate bindings, unsupported resource kinds and Kustomize transformations fail closed. ` +
    `Reads are bounded to 256 files, 1MiB per file and 8MiB total. Every reviewed workload must retain its kind, one concurrent replica and node01 selector; deployments must use Recreate.\n` +
    `- The revision binds deterministic relative paths and raw Kustomization, workload, PVC and referenced generator-file bytes. The additional verification Job uses a separate hash path. ` +
    `Configuration, secret values, environment, identities and raw annotations are never copied into this report.\n` +
    `- Missing inputs, stale metrics, incomplete pod lists or unknown disk counters fail closed. Snapshot success is not a promise of zero future shared-host impact, a storage quota, a backup or deployment authorization.\n`;
}

export async function readSourcePlan(sourceDirectory, additionalJobPath) {
  try {
    const root = await realpath(resolve(sourceDirectory));
    if (!(await stat(root)).isDirectory()) throw new Error('PLAN_INVALID');
    const tree = new SourceTree(root);
    await tree.visit(root);
    if (additionalJobPath === undefined) additionalJobPath = await defaultVerificationJob(sourceDirectory);
    if (additionalJobPath !== undefined) await tree.verificationJob(additionalJobPath);
    const hash = createHash('sha256');
    for (const [path, raw] of [...tree.sources].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      hash.update(path + '\0').update(raw).update('\0');
    }
    return buildPlan(tree.documents, hash.digest('hex'));
  } catch { throw new Error('PLAN_INVALID'); }
}

export async function generate(sourceDirectory, check = false, additionalJobPath) {
  const plan = await readSourcePlan(sourceDirectory, additionalJobPath);
  const outputs = [[new URL('../base/plan.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n'],
    [new URL('../PLAN.md', import.meta.url), explainPlan(plan)]];
  for (const [target, encoded] of outputs) {
    if (check) {
      if (encoded !== await readFile(target, 'utf8')) throw new Error('PLAN_CHANGED');
    } else await writeFile(target, encoded);
  }
  return plan;
}

async function defaultVerificationJob(sourceDirectory) {
  if (resolve(sourceDirectory) !== defaultSource) return undefined;
  const path = fileURLToPath(new URL('../../hupo-chat-verification/base/job.yaml', import.meta.url));
  try { await lstat(path); return path; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

class SourceTree {
  constructor(root) { this.root = root; this.documents = []; this.sources = new Map(); this.seen = new Set(); this.bytes = 0; }

  async verificationJob(path) {
    const boundary = new SourceTree(resolve(dirname(path)));
    const raw = await this.readRaw(await boundary.contained(resolve(path)));
    const doc = JSON.parse(raw.toString('utf8'));
    if (doc.kind !== 'Job' || doc.metadata?.name !== verificationName) throw new Error('PLAN_INVALID');
    this.documents.push(doc);
    this.sources.set('@verification/job.yaml', raw);
  }

  async visit(path, namespace = '') {
    path = await this.contained(path);
    if ((await stat(path)).isDirectory()) {
      const candidates = (await readdir(path)).filter(name => ['kustomization.yaml', 'kustomization.yml', 'Kustomization'].includes(name));
      if (candidates.length !== 1) throw new Error('PLAN_INVALID');
      path = await this.contained(join(path, candidates[0]));
    }
    const raw = await this.readRaw(path);
    const doc = JSON.parse(raw.toString('utf8'));
    if (doc.kind === 'Kustomization') {
      this.sources.set(relative(this.root, path).replaceAll('\\', '/'), raw);
      if (doc.apiVersion !== 'kustomize.config.k8s.io/v1beta1' || !Array.isArray(doc.resources) ||
          Object.keys(doc).some(key => !kustomizationKeys.includes(key)) ||
          (doc.namespace !== undefined && (typeof doc.namespace !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(doc.namespace)))) throw new Error('PLAN_INVALID');
      await this.generators(doc, dirname(path), namespace || doc.namespace || '');
      for (const child of doc.resources) {
        await this.visit(await this.reference(dirname(path), child), namespace || doc.namespace || '');
      }
    } else {
      this.documents.push(namespace && !clusterKinds.includes(doc.kind) ?
        { ...doc, metadata: { ...doc.metadata, namespace } } : doc);
      if (workloadKinds.includes(doc.kind) || doc.kind === 'PersistentVolumeClaim') {
        this.sources.set(relative(this.root, path).replaceAll('\\', '/'), raw);
      }
    }
  }

  async generators(doc, directory, namespace) {
    if (doc.configMapGenerator === undefined) return;
    if (!Array.isArray(doc.configMapGenerator)) throw new Error('PLAN_INVALID');
    for (const generator of doc.configMapGenerator) {
      if (!generator || Object.keys(generator).some(key => !['name', 'files', 'envs', 'literals', 'options', 'behavior'].includes(key)) ||
          (generator.behavior !== undefined && generator.behavior !== 'create')) throw new Error('PLAN_INVALID');
      this.documents.push({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: generator.name, namespace } });
      for (const key of ['files', 'envs']) {
        if (generator[key] !== undefined && !Array.isArray(generator[key])) throw new Error('PLAN_INVALID');
        for (const entry of generator[key] || []) {
          if (typeof entry !== 'string') throw new Error('PLAN_INVALID');
          const path = await this.reference(directory, key === 'files' && entry.includes('=') ? entry.slice(entry.indexOf('=') + 1) : entry);
          this.sources.set(relative(this.root, path).replaceAll('\\', '/'), await this.readRaw(path));
        }
      }
    }
  }

  async reference(directory, child) {
    if (typeof child !== 'string' || !/^[a-zA-Z0-9 _./-]+$/.test(child) || isAbsolute(child) ||
        child.split('/').some(part => part === '..' || part === '')) throw new Error('PLAN_INVALID');
    return this.contained(resolve(directory, child));
  }

  async readRaw(path) {
    if (this.seen.has(path) || this.seen.size >= 256) throw new Error('PLAN_INVALID');
    this.seen.add(path);
    if (!(await stat(path)).isFile()) throw new Error('PLAN_INVALID');
    const handle = await open(path, 'r');
    try {
      const info = await handle.stat();
      const limit = 1024 ** 2;
      if (!info.isFile() || info.size > limit) throw new Error('PLAN_INVALID');
      const raw = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < raw.length) {
        const { bytesRead } = await handle.read(raw, length, raw.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      this.bytes += length;
      if (length > limit || length !== info.size || this.bytes > 8 * limit) throw new Error('PLAN_INVALID');
      return raw.subarray(0, length);
    } finally { await handle.close(); }
  }

  async contained(path) {
    const target = await realpath(path);
    const local = relative(this.root, target);
    if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new Error('PLAN_INVALID');
    return target;
  }
}

function validateDocuments(documents) {
  if (!Array.isArray(documents)) throw new Error('PLAN_INVALID');
  const bindings = new Set();
  for (const doc of documents) {
    if (!doc || !Object.hasOwn(resourceApis, doc.kind) || doc.apiVersion !== resourceApis[doc.kind] ||
        typeof doc.metadata?.name !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(doc.metadata.name)) throw new Error('PLAN_INVALID');
    const namespace = clusterKinds.includes(doc.kind) ? '' : doc.metadata.namespace || '';
    const binding = JSON.stringify([doc.apiVersion.split('/').length === 1 ? '' : doc.apiVersion.split('/')[0],
      doc.kind, namespace, doc.metadata.name]);
    if (bindings.has(binding)) throw new Error('PLAN_INVALID');
    bindings.add(binding);
  }
}

function workloadBudget(doc) {
  const configured = doc.spec?.[doc.kind === 'Job' ? 'parallelism' : 'replicas'];
  const replicas = configured === undefined ? 1 : configured;
  if (replicas !== 1 || doc.kind !== reviewedKinds[doc.metadata.name.replace(/^hupo-chat-/, '')]) throw new Error('PLAN_INVALID');
  if (doc.kind === 'Deployment' && doc.spec.strategy?.type !== 'Recreate') throw new Error('PLAN_INVALID');
  const pod = { spec: doc.spec.template.spec };
  if (pod.spec.nodeSelector?.['kubernetes.io/hostname'] !== 'node01' ||
      (pod.spec.nodeName !== undefined && pod.spec.nodeName !== 'node01')) throw new Error('PLAN_INVALID');
  const requests = podResources(pod, 'requests', true);
  const limits = podResources(pod, 'limits', true);
  // Aggregate limits can hide an unbounded container behind a bounded peer.
  for (const container of [...pod.spec.containers, ...(pod.spec.initContainers || [])]) {
    if (quantity(container.resources?.limits?.memory, 'memory') <= 0n) throw new Error('PLAN_INVALID');
  }
  if (limits.memory < requests.memory) throw new Error('PLAN_INVALID');
  const claims = [...(doc.spec.volumeClaimTemplates || []),
    ...(pod.spec.volumes || []).filter(volume => volume.ephemeral).map(volume => volume.ephemeral.volumeClaimTemplate)];
  const storage = claims.reduce((sum, claim) =>
    sum + positiveStorage(claim?.spec?.resources?.requests?.storage), 0n);
  const ephemeral = (pod.spec.volumes || []).filter(v => v.emptyDir).reduce((sum, volume) => {
    if (!volume.emptyDir.sizeLimit) throw new Error('PLAN_INVALID');
    return sum + positiveStorage(volume.emptyDir.sizeLimit);
  }, 0n);
  const scaled = value => String(value * BigInt(replicas));
  return { name: doc.metadata.name, kind: doc.kind, replicas,
    cpuRequestsNanocores: scaled(requests.cpu), memoryRequestsBytes: scaled(requests.memory),
    memoryLimitsBytes: scaled(limits.memory), storageBytes: scaled(storage), emptyDirBytes: scaled(ephemeral) };
}

function positiveStorage(value) {
  const bytes = quantity(value, 'storage');
  if (bytes === 0n) throw new Error('PLAN_INVALID');
  return bytes;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { source, check, additionalJobPath } = parseArguments(process.argv.slice(2));
  const plan = await generate(source, check, additionalJobPath);
  console.log(JSON.stringify({ revision: plan.revision, totals: plan.totals, reserves: plan.reserves }));
}
