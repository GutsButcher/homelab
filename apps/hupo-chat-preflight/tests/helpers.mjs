import { readFile } from 'node:fs/promises';
export const plan = JSON.parse(await readFile(new URL('../base/plan.json', import.meta.url), 'utf8'));
export const now = Date.parse('2026-11-03T00:00:00Z');
export function inputs() {
  return { node: { metadata: { name: 'node01' }, spec: {}, status: {
    allocatable: { cpu: '4', memory: '20Gi', pods: '110' },
    conditions: [{ type: 'Ready', status: 'True' }, ...['MemoryPressure', 'DiskPressure', 'PIDPressure']
      .map(type => ({ type, status: 'False' }))] } }, pods: [],
    metrics: { metadata: { name: 'node01' }, timestamp: new Date(now).toISOString(), window: '30s',
      usage: { cpu: '500m', memory: '2Gi' } },
    disk: { bsize: 4096n, bavail: 100n * 1024n ** 3n / 4096n, files: 100000n, ffree: 90000n } };
}
export async function optionalImport(path) {
  return import(path).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
}
