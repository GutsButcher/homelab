import { createHash } from 'node:crypto';
import { lstat, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { podResources, quantity } from '../base/runtime/resources.mjs';

const components = ['web', 'worker', 'postgres', 'redis', 'prepare', 'namespace-secrets', 'owner-bootstrap'];
const reviewedKinds = { web: 'Deployment', worker: 'Deployment', postgres: 'StatefulSet', redis: 'StatefulSet',
  prepare: 'Job', 'namespace-secrets': 'Job', 'owner-bootstrap': 'Job', 'cluster-verification': 'Job', public: 'Deployment' };
const verificationName = 'hupo-chat-cluster-verification';
const tunnelName = 'hupo-chat-public';
const workloadKinds = ['Deployment', 'StatefulSet', 'Job', 'DaemonSet', 'CronJob', 'Pod'];
const resourceApis = { Deployment: 'apps/v1', StatefulSet: 'apps/v1', Job: 'batch/v1',
  Namespace: 'v1', ServiceAccount: 'v1', Service: 'v1', ConfigMap: 'v1', Secret: 'v1', PersistentVolumeClaim: 'v1',
  Role: 'rbac.authorization.k8s.io/v1', RoleBinding: 'rbac.authorization.k8s.io/v1',
  ClusterRole: 'rbac.authorization.k8s.io/v1', ClusterRoleBinding: 'rbac.authorization.k8s.io/v1',
  NetworkPolicy: 'networking.k8s.io/v1', SealedSecret: 'bitnami.com/v1alpha1' };
const clusterKinds = ['Namespace', 'ClusterRole', 'ClusterRoleBinding'];
const kustomizationKeys = ['apiVersion', 'kind', 'namespace', 'resources', 'configMapGenerator', 'generatorOptions'];
const defaultSource = fileURLToPath(new URL('../../hupo-chat/base', import.meta.url));
const retryPolicy = { schemaVersion: 1, prepareBackoffLimit: 2, prepareConcurrentReservation: 3, otherWorkloadReservation: 1 };

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
  if (names.includes(tunnelName)) expected.push(tunnelName);
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
  const tunnel = plan.workloads.some(row => row.name === tunnelName) ?
    'The actual public tunnel Deployment is included as a concurrent row, not hidden in reserves. ' :
    '**Tunnel Deployment is not included.** This budget cannot accept tunnel activation. ';
  const nine = plan.workloads.length === 9 ? 'All nine reviewed workloads are budgeted concurrently. The selected declared-retry reservation is eleven planned pods for nine workload rows. Older seven-workload evidence does not accept this nine-workload revision; older nine-pod evidence does not accept the new retry policy either. ' : '';
  const rows = plan.workloads.map(w => `| ${w.name} | ${w.replicas} | ${BigInt(w.cpuRequestsNanocores) / 1000000n}m | ${mi(w.memoryRequestsBytes)} | ${mi(w.memoryLimitsBytes)} |`).join('\n');
  return `# Generated source budget\n\n` +
    `Source: \`${plan.source}\`; relevant source SHA-256: \`${plan.revision}\`.\n\n` +
    `**Source budget only.** No live capacity result or deployment acceptance is established by generation. ${nine}` +
    `Before auxiliary activation, the exact new preflight source must pass native Node 24 tests, then a fresh matching live snapshot must pass all eight checks. No older snapshot accepts changed source bytes. Main application health remains unobserved by this source check.\n\n` +
    `| Workload | Planned pod reservation | CPU requests | Memory requests | Memory limits |\n` +
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
    `- ${tunnel}Canonical generation and \`--check\` also automatically include exactly \`homelab/apps/hupo-chat-public/base/deployment.yaml\` when present. ` +
    `No tunnel directory scan, basename guess, phase credit or generic cluster-YAML import is used. Copies of the canonical base without auxiliary inputs remain seven-row fixtures with nine planned pods, not auxiliary deployment proof.\n` +
    `- The selected declared-retry reservation is three complete prepare copies (backoffLimit + 1) and one copy of every other workload. All source parallelism/replica guards still require one configured replica. ` +
    `The reviewed prepare source must retain explicit integer backoffLimit=2; it has activeDeadlineSeconds=900 and terminationGracePeriodSeconds=40. CPU, memory, per-copy claims and emptyDirs are scaled for both declared retries on top of every normal workload row. ` +
    `This is not an absolute controller replacement hard cap: retries and terminating/replacement pods may overlap beyond this bounded declared-retry model. Arbitrary external deletions/controller replacement behavior are not bounded here. ` +
    `Any healthy-main/freeze requirement and broader replacement risk remain activation review gates, not phase credits.\n` +
    `- All existing nonterminal pods and actual usage are counted on top of the prospective plan, including existing copies of these workloads; no phase or existing-workload subtraction is allowed. ` +
    `The 1Gi memory and 10Gi disk reserves remain additional requirements, never auxiliary or retry credits.\n` +
    `- Both existing CPU requests and actual CPU usage, plus planned CPU requests and reserve, must fit allocatable CPU. CPU limits may still contend later.\n` +
    `- Existing memory requests plus planned requests and reserve must fit; max(existing requests, actual memory usage) plus all planned memory limits and reserve must also fit.\n` +
    `- Every regular and init container, including restartable init sidecars, must declare an explicit positive memory limit. A zero limit is unbounded, not a zero-byte cap. ` +
    `This fixed seven/eight/nine-workload source policy rejects zero container limits even with a positive pod-level memory cap; CPU and request semantics are unchanged.\n` +
    `- Every declared standalone PVC, per-replica volumeClaimTemplate and generic ephemeral claim template is included, plus positive emptyDir size limits and a separate image/log/growth reserve. ` +
    `Local-path sizes are not filesystem quotas or physical reservations. statfs reads only the dedicated read-only /probe-storage mount; it writes no test files.\n` +
    `- The verification Job declares 16Ki results plus 4Ki owner-envelope memory-backed emptyDirs (20Ki total). These bytes remain within measured memory/limits and are also conservatively charged in the disk bound; they are not excluded by their Memory medium. ` +
    `A retained earlier collector's 16Ki result bound is not a cleanup credit: actual residual memory/storage usage must still be measured until cleanup, regardless of terminal-pod filtering or TTL.\n` +
    `- Exclude only terminal pods and other nodes. Include scheduled Pending/Unknown pods, regular init peaks, ordered restartable-init sidecars, pod overhead, pod-level requests and enacted/in-flight resize allocations.\n` +
    `- Follow local JSON Kustomization resources recursively, not a directory-wide filename scan. Remote references, parent traversal, symlink escapes, cycles, duplicate bindings, unsupported resource kinds and Kustomize transformations fail closed. ` +
    `Reads are bounded to 256 files, 1MiB per file and 8MiB total. Every reviewed workload must retain its kind, one configured replica and node01 selector; deployments must use Recreate. ` +
    `The verifier must explicitly retain namespace hupo-chat, integer parallelism=1, completions=1, backoffLimit=0 and restartPolicy=Never, including explicit overrides. ` +
    `The tunnel must explicitly retain namespace hupo-chat, replicas=1 and no volumes/mounts; auxiliary Jobs cannot introduce PVC/host storage or unbound mounts.\n` +
    `- The revision binds deterministic relative paths and raw Kustomization, workload, PVC and referenced generator-file bytes, plus explicit versioned retry-policy bytes at @planner/retry-policy.json. Additional verification and tunnel resources use separate @verification/job.yaml and @tunnel/deployment.yaml hash paths. ` +
    `Canonical and auxiliary files must remain inside the real repository boundary; resource references also remain inside their selected canonical source tree. ` +
    `Configuration, secret values, environment, identities and raw annotations are never copied into this report.\n` +
    `- Missing inputs, stale metrics, incomplete pod lists or unknown disk counters fail closed. Snapshot success is not a promise of zero future shared-host impact, a storage quota, a backup or deployment authorization.\n`;
}

export async function readSourcePlan(sourceDirectory, additionalJobPath) {
  try {
    const root = await realpath(resolve(sourceDirectory));
    if (!(await stat(root)).isDirectory()) throw new Error('PLAN_INVALID');
    const repository = resolve(sourceDirectory) === defaultSource ?
      await realpath(fileURLToPath(new URL('../../../', import.meta.url))) : undefined;
    if (repository !== undefined) await new SourceTree(repository).contained(root);
    const tree = new SourceTree(root);
    await tree.visit(root);
    if (additionalJobPath === undefined) additionalJobPath = await defaultAdditional(sourceDirectory, '../../hupo-chat-verification/base/job.yaml');
    if (additionalJobPath !== undefined) await tree.additionalResource(additionalJobPath, 'Job', verificationName, '@verification/job.yaml', repository);
    const tunnel = await defaultAdditional(sourceDirectory, '../../hupo-chat-public/base/deployment.yaml');
    if (tunnel !== undefined) await tree.additionalResource(tunnel, 'Deployment', tunnelName, '@tunnel/deployment.yaml', repository);
    const hash = createHash('sha256');
    tree.sources.set('@planner/retry-policy.json', Buffer.from(JSON.stringify(retryPolicy) + '\n'));
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

async function defaultAdditional(sourceDirectory, resource) {
  if (resolve(sourceDirectory) !== defaultSource) return undefined;
  const path = fileURLToPath(new URL(resource, import.meta.url));
  try { await lstat(path); return path; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

class SourceTree {
  constructor(root) { this.root = root; this.documents = []; this.sources = new Map(); this.seen = new Set(); this.bytes = 0; }

  async additionalResource(path, kind, name, hashPath, repository = resolve(dirname(path))) {
    const boundary = new SourceTree(repository);
    const raw = await this.readRaw(await boundary.contained(resolve(path)));
    const doc = JSON.parse(raw.toString('utf8'));
    if (doc.kind !== kind || doc.metadata?.name !== name) throw new Error('PLAN_INVALID');
    this.documents.push(doc);
    this.sources.set(hashPath, raw);
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
  const sourceReplicas = configured === undefined ? 1 : configured;
  if (sourceReplicas !== 1 || doc.kind !== reviewedKinds[doc.metadata.name.replace(/^hupo-chat-/, '')]) throw new Error('PLAN_INVALID');
  const prepare = doc.metadata.name === 'hupo-chat-prepare';
  if (prepare && doc.spec.backoffLimit !== retryPolicy.prepareBackoffLimit) throw new Error('PLAN_INVALID');
  const replicas = prepare ? retryPolicy.prepareConcurrentReservation : retryPolicy.otherWorkloadReservation;
  if (doc.kind === 'Deployment' && doc.spec.strategy?.type !== 'Recreate') throw new Error('PLAN_INVALID');
  const pod = { spec: doc.spec.template.spec };
  if (doc.metadata.name === verificationName && (doc.metadata.namespace !== 'hupo-chat' ||
      doc.spec.parallelism !== 1 || doc.spec.completions !== 1 || doc.spec.backoffLimit !== 0 ||
      pod.spec.restartPolicy !== 'Never')) throw new Error('PLAN_INVALID');
  if ([verificationName, tunnelName].includes(doc.metadata.name)) validateAuxiliaryVolumes(doc, pod.spec);
  if (doc.metadata.name === tunnelName && (doc.metadata.namespace !== 'hupo-chat' || doc.spec.replicas !== 1 ||
      doc.spec.volumeClaimTemplates !== undefined || (pod.spec.volumes || []).length !== 0 ||
      [...(pod.spec.containers || []), ...(pod.spec.initContainers || [])].some(container =>
        (container.volumeMounts || []).length !== 0 || (container.volumeDevices || []).length !== 0))) throw new Error('PLAN_INVALID');
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

function validateAuxiliaryVolumes(doc, pod) {
  if (doc.spec.volumeClaimTemplates !== undefined ||
      (pod.volumes !== undefined && !Array.isArray(pod.volumes))) throw new Error('PLAN_INVALID');
  const volumes = pod.volumes || [];
  const names = new Set();
  for (const volume of volumes) {
    const types = Object.keys(volume).filter(key => key !== 'name');
    if (typeof volume.name !== 'string' || names.has(volume.name) || types.length !== 1 ||
        !['emptyDir', 'configMap', 'secret', 'projected', 'downwardAPI'].includes(types[0]) ||
        !volume[types[0]] || typeof volume[types[0]] !== 'object' || Array.isArray(volume[types[0]])) throw new Error('PLAN_INVALID');
    names.add(volume.name);
  }
  for (const container of [...(pod.containers || []), ...(pod.initContainers || [])]) {
    if ((container.volumeMounts !== undefined && !Array.isArray(container.volumeMounts)) ||
        (container.volumeDevices !== undefined && (!Array.isArray(container.volumeDevices) || container.volumeDevices.length))) throw new Error('PLAN_INVALID');
    if ((container.volumeMounts || []).some(mount => !names.has(mount.name))) throw new Error('PLAN_INVALID');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { source, check, additionalJobPath } = parseArguments(process.argv.slice(2));
  const plan = await generate(source, check, additionalJobPath);
  console.log(JSON.stringify({ revision: plan.revision, totals: plan.totals, reserves: plan.reserves }));
}
