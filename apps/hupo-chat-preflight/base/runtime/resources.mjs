// Nanocores avoid losing CPU precision in metrics; bytes round up.
export function allocatedRequests(pods, nodeName) {
  if (!Array.isArray(pods)) throw new Error('INPUT_INVALID');
  return pods.reduce((total, pod) => {
    if (pod.spec?.nodeName !== nodeName || ['Succeeded', 'Failed'].includes(pod.status?.phase)) return total;
    if (!['Pending', 'Running', 'Unknown'].includes(pod.status?.phase)) throw new Error('INPUT_INVALID');
    return add(total, podResources(pod));
  }, { cpu: 0n, memory: 0n });
}

export function podResources(pod, kind = 'requests', strict = false) {
  const spec = pod.spec;
  if (!Array.isArray(spec?.containers) || spec.containers.length === 0) throw new Error('INPUT_INVALID');
  let running = { cpu: 0n, memory: 0n };
  let sidecars = { cpu: 0n, memory: 0n };
  let initPeak = { cpu: 0n, memory: 0n };
  const statuses = [...(pod.status?.containerStatuses || []), ...(pod.status?.initContainerStatuses || [])];
  for (const container of spec.containers) running = add(running, containerResources(container, statuses, pod, kind, strict));
  for (const container of spec.initContainers || []) {
    const demand = containerResources(container, container.restartPolicy === 'Always' ? statuses : [], pod, kind, strict);
    if (container.restartPolicy === 'Always') {
      sidecars = add(sidecars, demand);
      running = add(running, demand);
      initPeak = maximum(initPeak, sidecars);
    } else initPeak = maximum(initPeak, add(sidecars, demand));
  }
  const result = maximum(running, initPeak);
  for (const resource of ['cpu', 'memory']) {
    const podLevel = spec.resources?.[kind]?.[resource];
    if (podLevel !== undefined) result[resource] = quantity(podLevel, resource);
    if (spec.overhead?.[resource] !== undefined) result[resource] += quantity(spec.overhead[resource], resource);
  }
  return result;
}

function containerResources(container, statuses, pod, kind, strict) {
  const result = {};
  const status = statuses.find(item => item.name === container.name);
  const infeasible = pod.status?.conditions?.some(c => c.type === 'PodResizePending' && c.reason === 'Infeasible');
  for (const resource of ['cpu', 'memory']) {
    const configured = container.resources?.[kind]?.[resource];
    if (strict && configured === undefined) throw new Error('PLAN_INVALID');
    let value = quantity(configured ?? '0', resource);
    if (kind === 'requests' && (status?.resources?.requests?.[resource] !== undefined ||
        status?.allocatedResources?.[resource] !== undefined)) {
      const enacted = quantity(status.resources?.requests?.[resource] ?? '0', resource);
      const allocated = quantity(status.allocatedResources?.[resource] ?? '0', resource);
      value = max(infeasible ? 0n : value, max(enacted, allocated));
    }
    result[resource] = value;
  }
  return result;
}

function add(a, b) { return { cpu: a.cpu + b.cpu, memory: a.memory + b.memory }; }
function maximum(a, b) { return { cpu: max(a.cpu, b.cpu), memory: max(a.memory, b.memory) }; }
function max(a, b) { return a > b ? a : b; }

export function quantity(value, resource) {
  if (!['string', 'number'].includes(typeof value) || String(value).length > 128) throw new Error('QUANTITY_INVALID');
  const match = String(value).match(/^(\+?)(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+|[numkKMGTPE]|[KMGTPE]i)?$/);
  if (!match || !['cpu', 'memory', 'storage'].includes(resource)) throw new Error('QUANTITY_INVALID');
  const [, , number, suffix = ''] = match;
  const [whole, fraction = ''] = number.split('.');
  let numerator = BigInt((whole || '0') + fraction);
  let denominator = 10n ** BigInt(fraction.length);
  const decimal = { n: -9, u: -6, m: -3, '': 0, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18 };
  if (suffix.endsWith('i')) {
    numerator *= 1024n ** BigInt('KMGTPE'.indexOf(suffix[0]) + 1);
  } else {
    const exponent = /^[eE][+-]?\d+$/.test(suffix) ? Number(suffix.slice(1)) : decimal[suffix];
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 30) throw new Error('QUANTITY_INVALID');
    if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
    else denominator *= 10n ** BigInt(-exponent);
  }
  if (resource === 'cpu') numerator *= 1000000000n;
  const result = (numerator + denominator - 1n) / denominator;
  if (result > 2n ** 100n) throw new Error('QUANTITY_INVALID');
  return result;
}
