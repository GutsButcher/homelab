import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, now, inputs, optionalImport } from './helpers.mjs';
const capacity = await optionalImport('../base/runtime/capacity.mjs');

test('headroom compares requests and actual usage against conservative limits and disk reserve', () => {
  assert.equal(typeof capacity.evaluate, 'function');
  const result = capacity.evaluate(inputs(), plan, 'node01', now);
  assert.equal(Object.values(result).every(Boolean), true);
  const low = inputs();
  low.node.status.allocatable.cpu = '1';
  low.node.status.allocatable.memory = '8Gi';
  low.disk.bavail = 1n;
  const checks = capacity.evaluate(low, plan, 'node01', now);
  assert.equal(checks.cpuAllocations, false);
  assert.equal(checks.cpuUsage, false);
  assert.equal(checks.memoryUsage, false);
  assert.equal(checks.disk, false);
  const assigned = inputs();
  assigned.pods.push({ spec: { nodeName: 'node01', containers: [{ resources: {
    requests: { cpu: '3', memory: '10Gi' } } }] }, status: { phase: 'Running' } });
  assert.equal(capacity.evaluate(assigned, plan, 'node01', now).cpuAllocations, false);
  assert.equal(capacity.evaluate(assigned, plan, 'node01', now).memoryUsage, false);
  assigned.node.status.conditions[0].status = 'Unknown';
  assert.equal(capacity.evaluate(assigned, plan, 'node01', now).nodeReady, false);
});

test('allocated-only resize status cannot report false CPU or memory headroom', () => {
  const data = inputs();
  data.pods.push({ spec: { nodeName: 'node01', containers: [{ name: 'a', resources: {
    requests: { cpu: '100m', memory: '64Mi' } } }] }, status: { phase: 'Running',
    containerStatuses: [{ name: 'a', allocatedResources: { cpu: '3', memory: '10Gi' } }] } });
  const checks = capacity.evaluate(data, plan, 'node01', now);
  assert.deepEqual({ cpuAllocations: checks.cpuAllocations, memoryUsage: checks.memoryUsage },
    { cpuAllocations: false, memoryUsage: false });
  assert.equal(Object.values(checks).every(Boolean), false);
});

test('unknown, mismatched, future or stale metrics fail closed', () => {
  assert.equal(typeof capacity.evaluate, 'function');
  for (const change of [x => { delete x.metrics; }, x => { delete x.metrics.usage.memory; },
    x => { x.metrics.metadata.name = 'other'; }, x => { x.metrics.timestamp = new Date(now - 100000).toISOString(); },
    x => { x.metrics.timestamp = new Date(now + 6000).toISOString(); }, x => { x.metrics.window = '10m0s'; },
    x => { delete x.node.status.allocatable.memory; }, x => { delete x.disk.bavail; }]) {
    const data = inputs();
    change(data);
    assert.throws(() => capacity.evaluate(data, plan, 'node01', now));
  }
});
