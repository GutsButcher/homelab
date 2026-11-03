import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import * as runtime from '../base/runtime/server.mjs';

const containerStartup = process.platform === 'linux' && process.env.HUPO_CONTAINER_STARTUP_TESTS === '1';

test('main-module identity resolves ConfigMap links but excludes imports and missing paths', () => {
  assert.equal(typeof runtime.isMainModule, 'function', 'main-module identity helper is missing');
  const fixture = new EntryFixture();
  try {
    const main = join(fixture.version, 'server.mjs');
    const other = join(fixture.version, 'other.mjs');
    writeFileSync(main, '// Path fixture only; never executed.\n');
    writeFileSync(other, '// Imported path fixture only.\n');
    const mount = join(fixture.root, 'mount');
    symlinkSync(fixture.version, mount, 'junction');
    const linked = join(mount, 'server.mjs');
    assert.equal(runtime.isMainModule(main, pathToFileURL(main).href), true);
    assert.equal(runtime.isMainModule(linked, pathToFileURL(main).href), true);
    assert.equal(runtime.isMainModule(linked, pathToFileURL(linked).href), true);
    assert.equal(runtime.isMainModule(other, pathToFileURL(main).href), false);
    assert.equal(runtime.isMainModule(undefined, pathToFileURL(main).href), false);
    assert.equal(runtime.isMainModule(join(fixture.root, 'missing.mjs'), pathToFileURL(main).href), false);
    assert.equal(runtime.isMainModule(main, 'https://example.invalid/server.mjs'), false);
  } finally { fixture.dispose(); }
});

test('isolated container starts the actual ConfigMap-linked entrypoint and never reports fake capacity',
  { skip: !containerStartup, timeout: 15000 }, async () => {
    const fixture = new EntryFixture();
    let child;
    let exited;
    let spawnError;
    try {
      const main = fixture.configMapSource();
      child = spawn(process.execPath, ['--max-old-space-size=64', main], {
        env: { NODE_NAME: 'node01' }, stdio: ['ignore', 'ignore', 'pipe']
      });
      exited = new Promise(resolve => child.once('exit', resolve));
      child.once('error', error => { spawnError = error; });
      let diagnosticBytes = 0;
      child.stderr.on('data', chunk => {
        diagnosticBytes += chunk.length;
        if (diagnosticBytes > 4096) child.kill('SIGKILL');
      });
      await requireHealth(child, () => spawnError);
      const response = await fetch('http://127.0.0.1:8080/report', { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      const report = await response.json();
      assert.equal(report.ok, false, 'no cluster credentials or disk/certificate inputs exist in this container');
      assert.equal(Object.values(report.checks).every(value => value === false), true);
      assert.equal(diagnosticBytes, 0);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await Promise.race([exited, delay(1500)]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
      }
      fixture.dispose();
    }
  });

class EntryFixture {
  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'hupo-entry-'));
    this.version = join(this.root, '..version');
    mkdirSync(this.version);
  }

  configMapSource() {
    const source = fileURLToPath(new URL('../base/runtime/', import.meta.url));
    const files = readdirSync(source).filter(name => name.endsWith('.mjs'));
    for (const name of files) copyFileSync(join(source, name), join(this.version, name));
    copyFileSync(new URL('../base/plan.json', import.meta.url), join(this.version, 'plan.json'));
    symlinkSync('..version', join(this.root, '..data'), 'dir');
    for (const name of [...files, 'plan.json']) symlinkSync(join('..data', name), join(this.root, name), 'file');
    return join(this.root, 'server.mjs');
  }

  dispose() { rmSync(this.root, { recursive: true, force: true }); }
}

async function requireHealth(child, spawnError) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    assert.equal(spawnError(), undefined, 'entrypoint process failed to spawn');
    assert.equal(child.exitCode, null, 'entrypoint exited before its health listener started');
    assert.equal(child.signalCode, null);
    let response;
    try { response = await fetch('http://127.0.0.1:8080/healthz', { signal: AbortSignal.timeout(250) }); }
    catch { await delay(50); continue; }
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { healthy: true });
    return;
  }
  assert.fail('actual ConfigMap-linked entrypoint never became healthy');
}
