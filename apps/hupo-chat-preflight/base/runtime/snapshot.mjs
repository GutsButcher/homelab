import { randomUUID } from 'node:crypto';
import { evaluate, fullPolicyMemoryDeficit } from './capacity.mjs';
import { validateCertificate } from './certificate.mjs';
import { bracketApplication, unknownApplicationSample } from './application.mjs';
import { diagnosticObservation, stateDiagnosticHeaders } from './diagnostic.mjs';

export const CHECK_NAMES = ['nodeReady', 'podSlots', 'cpuAllocations', 'cpuUsage', 'memoryRequests', 'memoryUsage', 'disk', 'certificate'];
const ERRORS = new Set(['NOT_READY', 'API_UNAVAILABLE', 'NODE_UNKNOWN', 'INPUT_INVALID', 'QUANTITY_INVALID',
  'METRICS_UNAVAILABLE', 'METRICS_STALE', 'DISK_UNAVAILABLE', 'CERT_UNAVAILABLE', 'CERT_INVALID',
  'REFRESH_TIMEOUT', 'REFRESH_FAILED', 'CAPACITY_LOW', 'STALE']);

export class ReportCache {
  #entry = { checks: emptyChecks(), nodeName: null, certificate: null, error: 'NOT_READY', at: null, nonce: randomUUID() };
  #active = null;

  constructor({ plan, collect, producerSha256, clock = Date.now, timeoutMs = 8000, maxStaleMs = 60000 }) {
    this.plan = plan;
    this.collect = collect;
    this.producerSha256 = producerSha256;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.maxStaleMs = maxStaleMs;
  }

  refresh() {
    if (this.#active) return this.#active;
    const at = this.clock();
    const abort = new AbortController();
    let timedOut = false;
    let finish;
    this.#active = new Promise(resolve => { finish = resolve; });
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
      this.#failure('REFRESH_TIMEOUT', at);
      finish();
      // Retain the lock until the aborted provider settles; no overlapping work.
    }, this.timeoutMs);
    Promise.resolve().then(() => this.collect(abort.signal, at + this.timeoutMs)).then(result => {
      if (timedOut) return;
      if (this.clock() <= at + this.timeoutMs) this.#store(result, at);
      if (this.clock() > at + this.timeoutMs) {
        timedOut = true;
        abort.abort();
        this.#failure('REFRESH_TIMEOUT', at);
      }
    }).catch(error => {
      if (!timedOut) this.#failure(safeCode(error), at);
    }).finally(() => {
      clearTimeout(timer);
      this.#active = null;
      finish();
    });
    return this.#active;
  }

  report() {
    const entry = this.#entry;
    const age = entry.at === null ? null : this.clock() - entry.at;
    const fresh = age !== null && age >= 0 && age <= this.maxStaleMs && this.clock() <= (entry.validUntil ?? Infinity);
    const checks = fresh ? { ...entry.checks } : emptyChecks();
    let error = entry.error;
    if (entry.at !== null && !fresh) error = 'STALE';
    if (checks.certificate) {
      try { validateCertificate(entry.certificate, this.clock()); }
      catch { checks.certificate = false; error = 'CERT_INVALID'; }
    }
    return { schemaVersion: 1, ok: fresh && error === null && CHECK_NAMES.every(name => checks[name]),
      checks, nonce: entry.nonce, revision: /^[a-f0-9]{64}$/.test(this.plan.revision) ? this.plan.revision : null,
      observedNode: entry.nodeName, observedAt: entry.at === null ? null : new Date(entry.at).toISOString(),
      ageSeconds: age === null ? null : Math.max(0, Math.floor(age / 1000)), fresh, error };
  }

  certificate() {
    const report = this.report();
    return report.fresh && report.checks.certificate ? this.#entry.certificate : null;
  }

  diagnostic(report) {
    const entry = this.#entry;
    if (report.nonce !== entry.nonce || report.revision !== this.plan.revision || report.observedNode !== entry.nodeName ||
        report.observedAt !== new Date(entry.at).toISOString() ||
        this.clock() > (entry.validUntil ?? Infinity)) return {};
    return stateDiagnosticHeaders(report, entry.diagnostic, this.producerSha256, this.clock());
  }

  #store(result, at) {
    const checks = Object.fromEntries(CHECK_NAMES.map(name => [name, result?.checks?.[name] === true]));
    const nodeName = result?.nodeName === this.plan.targetNode ? result.nodeName : null;
    if (nodeName === null) checks.nodeReady = false;
    let certificate = null;
    if (checks.certificate) certificate = validateCertificate(result.certificate, this.clock());
    const error = result?.error ? safeCode({ message: result.error }) : CHECK_NAMES.every(name => checks[name]) ? null : 'CAPACITY_LOW';
    const validUntil = Math.min(at + this.maxStaleMs, Number.isFinite(result?.validUntil) ? result.validUntil : at + this.maxStaleMs);
    this.#entry = { checks, nodeName, certificate, error, at, validUntil, nonce: randomUUID(),
      diagnostic: diagnosticObservation(result?.diagnostic, this.clock()) };
  }

  #failure(error, at) {
    this.#entry = { checks: emptyChecks(), nodeName: null, certificate: null, error, at, nonce: randomUUID() };
  }
}

export async function observe(plan, ownNode, { reader, readDisk, readCert, clock = Date.now }, signal, deadline = clock() + 8000) {
  const first = await readApplication(reader, signal, clock, deadline);
  const results = await Promise.allSettled([reader.readInputs(ownNode, signal), readDisk(), readCert(signal)]);
  const [api, disk, cert] = results;
  let checks = emptyChecks();
  let nodeName = null;
  let error = null;
  let certificate = null;
  if (api.status !== 'fulfilled') error = 'API_UNAVAILABLE';
  else if (disk.status !== 'fulfilled') error = 'DISK_UNAVAILABLE';
  else {
    try {
      checks = { ...checks, ...evaluate({ ...api.value, disk: disk.value }, plan, ownNode, clock()) };
      nodeName = ownNode;
    } catch (failure) { error = safeCode(failure, 'INPUT_INVALID'); }
  }
  if (cert.status !== 'fulfilled') error ||= 'CERT_UNAVAILABLE';
  else {
    try {
      certificate = validateCertificate(cert.value, clock());
      checks.certificate = true;
    } catch { error ||= 'CERT_INVALID'; }
  }
  if (!error && !Object.values(checks).every(Boolean)) error = 'CAPACITY_LOW';
  const timestamp = api.status === 'fulfilled' ? Date.parse(api.value.metrics?.timestamp) : NaN;
  const validUntil = Number.isFinite(timestamp) ? timestamp + 60000 : clock() + 60000;
  const second = await readApplication(reader, signal, clock, deadline);
  const application = bracketApplication(first, second, clock());
  const capacity = api.status === 'fulfilled' ? fullPolicyMemoryDeficit(api.value, plan, ownNode, clock()) :
    { state: 'UNKNOWN', fullPolicyDeficitMi: null };
  return { checks, nodeName, certificate, error, validUntil,
    diagnostic: { capacity, application: application.application, applicationValidUntil: application.validUntil } };
}

async function readApplication(reader, signal, clock, deadline) {
  // Leave room to publish mandatory inputs rather than letting an optional read time them out.
  if (signal?.aborted || deadline - clock() < 800 || typeof reader.readApplication !== 'function') return unknownApplicationSample();
  try { return await reader.readApplication(signal, clock, deadline); }
  catch { return unknownApplicationSample(); }
}

export function emptyChecks() { return Object.fromEntries(CHECK_NAMES.map(name => [name, false])); }
export function safeCode(error, fallback = 'REFRESH_FAILED') {
  return ERRORS.has(error?.message) ? error.message : fallback;
}
