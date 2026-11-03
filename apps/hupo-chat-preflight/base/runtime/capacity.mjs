import { allocatedRequests, quantity } from './resources.mjs';

export function evaluate(input, plan, ownNode, now) {
  if (ownNode !== plan.targetNode || input.node?.metadata?.name !== ownNode) throw new Error('NODE_UNKNOWN');
  const capacity = input.node.status?.allocatable;
  if (!capacity || capacity.cpu === undefined || capacity.memory === undefined || capacity.pods === undefined) throw new Error('INPUT_INVALID');
  const cpu = quantity(capacity.cpu, 'cpu');
  const memory = quantity(capacity.memory, 'memory');
  const podSlots = quantity(capacity.pods, 'memory');
  if (cpu === 0n || memory === 0n || podSlots === 0n) throw new Error('INPUT_INVALID');
  validateMetrics(input.metrics, ownNode, now);
  const usage = { cpu: quantity(input.metrics.usage.cpu, 'cpu'), memory: quantity(input.metrics.usage.memory, 'memory') };
  const allocated = allocatedRequests(input.pods, ownNode);
  const p = plan.totals;
  const r = plan.reserves;
  const pressure = ['MemoryPressure', 'DiskPressure', 'PIDPressure'];
  const conditions = input.node.status.conditions || [];
  const plannedPods = plan.workloads.reduce((sum, row) => sum + BigInt(row.replicas), 0n);
  const currentPods = input.pods.filter(pod => pod.spec?.nodeName === ownNode && !['Succeeded', 'Failed'].includes(pod.status?.phase)).length;
  return {
    nodeReady: input.node.spec?.unschedulable !== true && conditions.some(c => c.type === 'Ready' && c.status === 'True') &&
      pressure.every(type => conditions.some(c => c.type === type && c.status === 'False')),
    podSlots: BigInt(currentPods) + plannedPods <= podSlots,
    cpuAllocations: allocated.cpu + BigInt(p.cpuRequestsNanocores) + BigInt(r.cpuNanocores) <= cpu,
    cpuUsage: usage.cpu + BigInt(p.cpuRequestsNanocores) + BigInt(r.cpuNanocores) <= cpu,
    memoryRequests: allocated.memory + BigInt(p.memoryRequestsBytes) + BigInt(r.memoryBytes) <= memory,
    memoryUsage: max(allocated.memory, usage.memory) + BigInt(p.memoryLimitsBytes) + BigInt(r.memoryBytes) <= memory,
    disk: diskHeadroom(input.disk, BigInt(p.pvcBytes) + BigInt(p.emptyDirBytes) + BigInt(r.diskBytes), BigInt(r.freeInodes))
  };
}

function validateMetrics(metrics, nodeName, now) {
  if (metrics?.metadata?.name !== nodeName || metrics.usage?.cpu === undefined || metrics.usage?.memory === undefined) throw new Error('METRICS_UNAVAILABLE');
  const timestamp = Date.parse(metrics.timestamp);
  const window = /^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/.exec(metrics.window || '');
  const seconds = window ? Number(window[1] || 0) * 60 + Number(window[2]) : NaN;
  if (!Number.isFinite(timestamp) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60 ||
      now - timestamp > 60000 || timestamp - now > 5000 || now - timestamp + seconds * 1000 > 120000) throw new Error('METRICS_STALE');
}

function diskHeadroom(disk, required, inodeReserve) {
  for (const field of ['bsize', 'bavail', 'files', 'ffree']) {
    if (typeof disk?.[field] !== 'bigint' || disk[field] < 0n) throw new Error('DISK_UNAVAILABLE');
  }
  if (disk.bsize === 0n || disk.files === 0n || disk.ffree > disk.files) throw new Error('DISK_UNAVAILABLE');
  return disk.bsize * disk.bavail >= required && disk.ffree >= inodeReserve;
}

function max(a, b) { return a > b ? a : b; }
