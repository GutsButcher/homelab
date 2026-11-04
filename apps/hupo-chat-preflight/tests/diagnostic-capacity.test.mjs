import test from 'node:test';
import assert from 'node:assert/strict';
import * as capacity from '../base/runtime/capacity.mjs';
import { plan, now, inputs } from './helpers.mjs';

const Mi = 1024n ** 2n;
const required = BigInt(plan.totals.memoryLimitsBytes) + BigInt(plan.reserves.memoryBytes);

test('diagnostic deficit uses the larger enacted allocation or observed usage without credits', () => {
  const data = atBoundary();
  data.pods = [{ spec: { nodeName: 'node01', containers: [{ name: 'one', resources: { requests: { memory: '3Gi' } } }] },
    status: { phase: 'Running', containerStatuses: [{ name: 'one', allocatedResources: { memory: '4Gi' } }] } }];
  assert.deepEqual(capacity.fullPolicyMemoryDeficit(data, plan, 'node01', now), { state: 'KNOWN', fullPolicyDeficitMi: 2048 });
  data.metrics.usage.memory = '5Gi';
  assert.deepEqual(capacity.fullPolicyMemoryDeficit(data, plan, 'node01', now), { state: 'KNOWN', fullPolicyDeficitMi: 3072 });
});

test('diagnostic deficit is UNKNOWN for invalid inputs and cannot expose unsafe integer estimates', () => {
  const mutations = [
    data => { data.node.metadata.name = 'wrong'; }, data => { data.node.status.allocatable.memory = '0'; },
    data => { data.node.status.allocatable.memory = '-1'; }, data => { delete data.node.status.allocatable; },
    data => { data.metrics.usage.memory = 'canary'; }, data => { data.metrics.usage.cpu = 'canary'; },
    data => { data.metrics.timestamp = new Date(now - 60001).toISOString(); },
    data => { data.metrics.timestamp = new Date(now + 5001).toISOString(); },
    data => { data.metrics.window = '61s'; }, data => { data.pods = null; }
  ];
  for (const [index, mutate] of mutations.entries()) {
    const data = atBoundary(); mutate(data);
    assert.deepEqual(capacity.fullPolicyMemoryDeficit(data, plan, 'node01', now), { state: 'UNKNOWN', fullPolicyDeficitMi: null }, `input-${index}`);
  }
  for (const value of [null, '', '-1', '1.5', 'bad', 123, true, '0']) {
    const changed = structuredClone(plan); changed.totals.memoryLimitsBytes = value;
    assert.equal(capacity.fullPolicyMemoryDeficit(atBoundary(), changed, 'node01', now).state, 'UNKNOWN', `limit-${value}`);
  }
  for (const value of [null, '', '-1', '1.5', 'bad', true]) {
    const changed = structuredClone(plan); changed.reserves.memoryBytes = value;
    assert.equal(capacity.fullPolicyMemoryDeficit(atBoundary(), changed, 'node01', now).state, 'UNKNOWN', `reserve-${value}`);
  }
  const huge = structuredClone(plan); huge.totals.memoryLimitsBytes = String(2n ** 100n);
  assert.equal(capacity.fullPolicyMemoryDeficit(atBoundary(), huge, 'node01', now).state, 'UNKNOWN');
  assert.equal(capacity.fullPolicyMemoryDeficit(atBoundary(), plan, 'node02', now).state, 'UNKNOWN');
  assert.equal(capacity.fullPolicyMemoryDeficit(atBoundary(), plan, 'node01', NaN).state, 'UNKNOWN');
});

function atBoundary(offset = 0n) {
  const data = inputs();
  data.node.status.allocatable.memory = String(required + 2n * 1024n ** 3n + offset);
  return data;
}

test('diagnostic full-policy deficit preserves the exact memoryUsage boundary and rounds one byte up', () => {
  assert.equal(typeof capacity.fullPolicyMemoryDeficit, 'function');
  for (const [offset, expected] of [[0n, 0], [1n, 0], [-1n, 1], [-Mi, 1], [-Mi - 1n, 2]]) {
    const data = atBoundary(offset);
    assert.deepEqual(capacity.fullPolicyMemoryDeficit(data, plan, 'node01', now),
      { state: 'KNOWN', fullPolicyDeficitMi: expected }, String(offset));
    assert.equal(capacity.evaluate(data, plan, 'node01', now).memoryUsage, offset >= 0n);
  }
});
