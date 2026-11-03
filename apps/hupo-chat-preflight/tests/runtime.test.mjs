import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, now, inputs, optionalImport } from './helpers.mjs';
const runtime = await optionalImport('../base/runtime/server.mjs');

test('runtime wires bounded HTTP and scheduled cache refresh without starting a local server in tests', async () => {
  assert.equal(typeof runtime.PreflightService, 'function');
  const events = [];
  let handler;
  const fake = { on: (name, callback) => { events.push(['on', name]); return fake; },
    listen: (...args) => events.push(['listen', ...args]), close: callback => { events.push(['close']); callback?.(); } };
  const service = new runtime.PreflightService({ plan, ownNode: 'node01', provider: {
    reader: { readInputs: async () => inputs() }, readDisk: async () => inputs().disk, readCert: async () => 'invalid', clock: () => now },
    makeServer: (options, callback) => { assert.equal(options.requestTimeout, 5000); handler = callback; return fake; },
    schedule: (callback, ms) => { events.push(['schedule', ms]); return 123; },
    cancel: id => events.push(['cancel', id]) });
  assert.equal(events.some(e => e[0] === 'listen'), false);
  service.start();
  assert.equal(events.some(e => e[0] === 'schedule' && e[1] === 20000), true);
  assert.equal(events.some(e => e[0] === 'listen' && e[1] === 8080 && e[2] === '0.0.0.0'), true);
  await service.cache.refresh();
  const response = {};
  handler({ method: 'GET', url: '/report' }, { writeHead: status => { response.status = status; }, end: body => { response.body = body; } });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).ok, false);
  assert.equal(JSON.parse(response.body).error, 'CERT_INVALID');
  await service.stop();
  assert.equal(events.some(e => e[0] === 'cancel' && e[1] === 123), true);
});
