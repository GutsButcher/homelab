import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, appendFile, rm, symlink } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { optionalImport, plan } from './helpers.mjs';
const producer = await optionalImport('../base/runtime/producer.mjs');
const files = ['application.mjs', 'capacity.mjs', 'certificate.mjs', 'diagnostic.mjs', 'endpoint.mjs', 'plan.json',
  'producer.mjs', 'public-endpoint.mjs', 'resources.mjs', 'server.mjs', 'snapshot.mjs', 'upstream.mjs'];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hupo-producer-'));
  const version = join(root, '..version'); await mkdir(version);
  for (const name of files) await copyFile(new URL(name === 'plan.json' ? '../base/plan.json' : '../base/runtime/' + name, import.meta.url), join(version, name));
  const module = await import(pathToFileURL(join(version, 'producer.mjs')).href);
  return { root, version, module, dispose: () => rm(root, { recursive: true, force: true }) };
}

test('ConfigMap projects exactly the fingerprint allowlist and startup loads that plan and digest together', async () => {
  const config = JSON.parse(await readFile(new URL('../base/kustomization.yaml', import.meta.url), 'utf8'));
  const projected = config.configMapGenerator[0].files.map(path => path.replace(/^runtime\//, '')).sort();
  assert.deepEqual(projected, files);
  const server = await readFile(new URL('../base/runtime/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /const \{ plan, producerSha256 \} = await loadProducer\(\)/);
  assert.match(server, /new PreflightService\(\{ plan, producerSha256,/);
});

test('producer rejects oversized, missing, nonregular and escaped allowlist entries with only a fixed error', async () => {
  for (const mode of ['oversized', 'missing', 'directory', 'escape', 'bad-plan']) {
    const box = await fixture();
    try {
      const target = join(box.version, mode === 'bad-plan' ? 'plan.json' : 'capacity.mjs');
      await rm(target);
      if (mode === 'oversized') await writeFile(target, 'x'.repeat(65537));
      if (mode === 'directory') await mkdir(target);
      if (mode === 'bad-plan') await writeFile(target, 'raw-secret-canary');
      if (mode === 'escape') {
        const external = join(box.root, 'external'); await mkdir(external);
        await symlink(external, target, process.platform === 'win32' ? 'junction' : 'dir');
      }
      await assert.rejects(box.module.loadProducer(), /^Error: PRODUCER_INVALID$/, mode);
    } finally { await box.dispose(); }
  }
});

test('producer accepts the ConfigMap version-directory alias without hashing symlink text', async () => {
  const box = await fixture();
  try {
    const expected = await box.module.loadProducer();
    const mount = join(box.root, 'mounted');
    await symlink(box.version, mount, process.platform === 'win32' ? 'junction' : 'dir');
    const linked = await import(pathToFileURL(join(mount, 'producer.mjs')).href);
    assert.deepEqual(await linked.loadProducer(), expected);
  } finally { await box.dispose(); }
});

test('producer fingerprints a fixed bounded byte allowlist rather than discovery or supplied paths', async () => {
  assert.equal(typeof producer.loadProducer, 'function');
  assert.deepEqual(producer.PRODUCER_FILES, files);
  const box = await fixture();
  try {
    const result = await box.module.loadProducer();
    const hash = createHash('sha256').update('hupo-state-producer-v1\0');
    for (const name of files) {
      const bytes = await readFile(join(box.version, name));
      hash.update(name + '\0' + bytes.length + '\0'); hash.update(bytes); hash.update('\0');
    }
    assert.deepEqual(result, { producerSha256: hash.digest('hex'), plan });
    await writeFile(join(box.version, 'unlisted-canary'), 'raw-secret-canary');
    assert.deepEqual(await box.module.loadProducer('caller-selected/secret'), result);
    await appendFile(join(box.version, 'capacity.mjs'), '\n');
    const changed = await box.module.loadProducer();
    assert.notEqual(changed.producerSha256, result.producerSha256);
    await appendFile(join(box.version, 'plan.json'), '\n');
    assert.notEqual((await box.module.loadProducer()).producerSha256, changed.producerSha256);
  } finally { await box.dispose(); }
});
