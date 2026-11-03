import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { podResources, quantity } from '../base/runtime/resources.mjs';

const components = ['web', 'worker', 'postgres', 'redis', 'prepare'];
const workloadKinds = ['Deployment', 'StatefulSet', 'Job', 'DaemonSet', 'CronJob', 'Pod'];

export function parseArguments(args) {
  const source = args.find(arg => arg !== '--check') ||
    fileURLToPath(new URL('../../hupo-chat/base', import.meta.url));
  return { source, check: args.includes('--check') };
}

export function buildPlan(documents, revision) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('PLAN_INVALID');
  const workloads = documents.filter(doc => workloadKinds.includes(doc.kind));
  const names = workloads.map(doc => doc.metadata?.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(components.map(c => `hupo-chat-${c}`).sort())) throw new Error('PLAN_INVALID');
  const rows = workloads.map(workloadBudget);
  const sum = key => rows.reduce((total, row) => total + BigInt(row[key]), 0n);
  const pvcBytes = documents.filter(doc => doc.kind === 'PersistentVolumeClaim').reduce((total, doc) =>
    total + quantity(doc.spec.resources.requests.storage, 'storage'), sum('storageBytes'));
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
  const rows = plan.workloads.map(w => `| ${w.name} | ${w.replicas} | ${BigInt(w.cpuRequestsNanocores) / 1000000n}m | ${mi(w.memoryRequestsBytes)} | ${mi(w.memoryLimitsBytes)} |`).join('\n');
  return `# Generated snapshot budget\n\n` +
    `Source: \`${plan.source}\`; relevant source SHA-256: \`${plan.revision}\`.\n\n` +
    `| Workload | Concurrent replicas | CPU requests | Memory requests | Memory limits |\n` +
    `| --- | ---: | ---: | ---: | ---: |\n${rows}\n\n` +
    `Totals: **${BigInt(t.cpuRequestsNanocores) / 1000000n}m CPU requests**, **${mi(t.memoryRequestsBytes)} memory requests**, **${mi(t.memoryLimitsBytes)} memory limits**.\n\n` +
    `Declared app PVCs: ${t.pvcBytes} bytes; declared emptyDir bounds: ${t.emptyDirBytes} bytes; explicit disk reserve: ${r.diskBytes} bytes. ` +
    `Required available bytes on the own local-path PVC filesystem: **${disk}** (${(Number(disk) / 1024 ** 3).toFixed(3)} GiB).\n\n` +
    `CPU reserve: ${BigInt(r.cpuNanocores) / 1000000n}m. Memory reserve: ${mi(r.memoryBytes)}. Free-inode reserve: ${r.freeInodes}.\n\n` +
    `- Snapshot candidate: **${plan.targetNode}** (documented worker). This is a chosen target, not a live observation; deployment selector, exact-node RBAC and runtime allowlist agree. ` +
    `The public observedNode is populated only after an actual matching API observation.\n` +
    `- Count prepare concurrently with every steady-state workload, even though migration normally precedes web/worker. No existing workload is subtracted.\n` +
    `- Both existing CPU requests and actual CPU usage, plus planned CPU requests and reserve, must fit allocatable CPU. CPU limits may still contend later.\n` +
    `- Existing memory requests plus planned requests and reserve must fit; max(existing requests, actual memory usage) plus all planned memory limits and reserve must also fit.\n` +
    `- Every declared standalone PVC and per-replica volumeClaimTemplate is included, plus emptyDir size limits and a separate image/log/growth reserve. ` +
    `Local-path sizes are not filesystem quotas or physical reservations. statfs reads only the dedicated read-only /probe-storage mount; it writes no test files.\n` +
    `- Exclude only terminal pods and other nodes. Include scheduled Pending/Unknown pods, regular init peaks, ordered restartable-init sidecars, pod overhead, pod-level requests and enacted/in-flight resize allocations.\n` +
    `- Missing inputs, stale metrics, incomplete pod lists or unknown disk counters fail closed. Snapshot success is not a promise of zero future shared-host impact, a storage quota, a backup or deployment authorization.\n`;
}

export async function generate(sourceDirectory, check = false) {
  const filenames = (await readdir(sourceDirectory)).filter(name => /\.ya?ml$/.test(name)).sort();
  const hash = createHash('sha256');
  const documents = [];
  for (const filename of filenames) {
    const raw = await readFile(join(sourceDirectory, filename), 'utf8');
    const doc = JSON.parse(raw);
    // Ignore config and policy content; no credentials or environment are copied.
    if (workloadKinds.includes(doc.kind) || doc.kind === 'PersistentVolumeClaim') {
      documents.push(doc);
      hash.update(filename + '\0' + raw + '\0');
    }
  }
  const plan = buildPlan(documents, hash.digest('hex'));
  const outputs = [[new URL('../base/plan.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n'],
    [new URL('../PLAN.md', import.meta.url), explainPlan(plan)]];
  for (const [target, encoded] of outputs) {
    if (check) {
      if (encoded !== await readFile(target, 'utf8')) throw new Error('PLAN_CHANGED');
    } else await writeFile(target, encoded);
  }
  return plan;
}

function workloadBudget(doc) {
  const replicas = doc.kind === 'Job' ? (doc.spec.parallelism ?? 1) : (doc.spec.replicas ?? 1);
  if (!Number.isSafeInteger(replicas) || replicas < 1 || !['Deployment', 'StatefulSet', 'Job'].includes(doc.kind)) throw new Error('PLAN_INVALID');
  const pod = { spec: doc.spec.template.spec };
  const requests = podResources(pod, 'requests', true);
  const limits = podResources(pod, 'limits', true);
  if (limits.memory < requests.memory) throw new Error('PLAN_INVALID');
  const storage = (doc.spec.volumeClaimTemplates || []).reduce((sum, claim) =>
    sum + quantity(claim.spec.resources.requests.storage, 'storage'), 0n);
  const ephemeral = (pod.spec.volumes || []).filter(v => v.emptyDir).reduce((sum, volume) => {
    if (!volume.emptyDir.sizeLimit) throw new Error('PLAN_INVALID');
    return sum + quantity(volume.emptyDir.sizeLimit, 'storage');
  }, 0n);
  const scaled = value => String(value * BigInt(replicas));
  return { name: doc.metadata.name, kind: doc.kind, replicas,
    cpuRequestsNanocores: scaled(requests.cpu), memoryRequestsBytes: scaled(requests.memory),
    memoryLimitsBytes: scaled(limits.memory), storageBytes: scaled(storage), emptyDirBytes: scaled(ephemeral) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { source, check } = parseArguments(process.argv.slice(2));
  const plan = await generate(source, check);
  console.log(JSON.stringify({ revision: plan.revision, totals: plan.totals, reserves: plan.reserves }));
}
