import test from 'node:test';
import assert from 'node:assert/strict';
const resources = await import('../base/runtime/resources.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

test('quantities use exact integer nanocores and bytes, rounding up', () => {
  assert.equal(typeof resources.quantity, 'function');
  const q = resources.quantity;
  assert.equal(q('250m', 'cpu'), 250000000n);
  assert.equal(q('1', 'cpu'), 1000000000n);
  assert.equal(q('500u', 'cpu'), 500000n);
  assert.equal(q('1n', 'cpu'), 1n);
  assert.equal(q('1e-3', 'cpu'), 1000000n);
  assert.equal(q('.5', 'cpu'), 500000000n);
  assert.equal(q('1.5Gi', 'memory'), 1610612736n);
  assert.equal(q('1G', 'memory'), 1000000000n);
  assert.equal(q('1m', 'memory'), 1n);
  assert.throws(() => q('0'.repeat(500) + '1', 'cpu'));
  for (const bad of ['-1', 'NaN', '1garbage', 'Infinity', '', '1e9999']) {
    assert.throws(() => q(bad, 'cpu'));
  }
});

test('pod allocation includes init maxima, ordered sidecars, overhead and excludes terminal pods', () => {
  assert.equal(typeof resources.allocatedRequests, 'function');
  const c = (cpu, memory, extra = {}) => ({ resources: { requests: { cpu, memory } }, ...extra });
  const pod = { spec: { nodeName: 'node01', containers: [c('100m', '100Mi')],
    initContainers: [c('50m', '20Mi', { restartPolicy: 'Always' }), c('500m', '200Mi'),
      c('80m', '40Mi', { restartPolicy: 'Always' }), c('200m', '300Mi')],
    overhead: { cpu: '10m', memory: '5Mi' } }, status: { phase: 'Running' } };
  const terminal = structuredClone(pod);
  terminal.status.phase = 'Succeeded';
  const failed = structuredClone(pod);
  failed.status.phase = 'Failed';
  const other = structuredClone(pod);
  other.spec.nodeName = 'elsewhere';
  const pending = structuredClone(pod);
  delete pending.spec.nodeName;
  assert.deepEqual(resources.allocatedRequests([pod, terminal, failed, other, pending], 'node01'),
    { cpu: 560000000n, memory: 365n * 1024n ** 2n });
});

test('allocated-only resize status counts CPU and memory without enacted resources', () => {
  const pod = { spec: { nodeName: 'node01', containers: [{ name: 'a', resources: {
    requests: { cpu: '100m', memory: '64Mi' } } }] }, status: { phase: 'Running',
    containerStatuses: [{ name: 'a', allocatedResources: { cpu: '3', memory: '10Gi' } }] } };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 3000000000n, memory: 10n * 1024n ** 3n });
  pod.spec.containers[0].resources.requests = { cpu: '4', memory: '12Gi' };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 4000000000n, memory: 12n * 1024n ** 3n });
  pod.status.conditions = [{ type: 'PodResizePending', reason: 'Infeasible' }];
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 3000000000n, memory: 10n * 1024n ** 3n });
});

test('infeasible allocated-only resize keeps configured requests for an unreported resource', () => {
  const pod = { spec: { nodeName: 'node01', containers: [{ name: 'a', resources: {
    requests: { cpu: '100m', memory: '64Mi' } } }] }, status: { phase: 'Running',
    conditions: [{ type: 'PodResizePending', reason: 'Infeasible' }],
    containerStatuses: [{ name: 'a', allocatedResources: { cpu: '3' } }] } };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 3000000000n, memory: 64n * 1024n ** 2n });
  pod.status.containerStatuses[0].allocatedResources = { memory: '10Gi' };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 100000000n, memory: 10n * 1024n ** 3n });
});

test('pod-level requests replace container totals and resize uses status allocations', () => {
  const pod = { spec: { nodeName: 'node01', containers: [{ name: 'a', resources: {
    requests: { cpu: '100m', memory: '10Mi' } } }], resources: { requests: { cpu: '1', memory: '1Gi' } },
    overhead: { cpu: '10m', memory: '1Mi' } }, status: { phase: 'Running', containerStatuses: [{
      name: 'a', resources: { requests: { cpu: '500m', memory: '20Mi' } },
      allocatedResources: { cpu: '600m', memory: '30Mi' } }] } };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 1010000000n, memory: 1025n * 1024n ** 2n });
  delete pod.spec.resources;
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 610000000n, memory: 31n * 1024n ** 2n });
  pod.status.conditions = [{ type: 'PodResizePending', reason: 'Infeasible' }];
  pod.spec.containers[0].resources.requests = { cpu: '2', memory: '1Gi' };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 610000000n, memory: 31n * 1024n ** 2n });
  pod.status.containerStatuses[0].resources.requests = { cpu: '800m', memory: '40Mi' };
  assert.deepEqual(resources.allocatedRequests([pod], 'node01'), {
    cpu: 810000000n, memory: 41n * 1024n ** 2n });
  delete pod.spec.containers;
  assert.throws(() => resources.allocatedRequests([pod], 'node01'));
});
