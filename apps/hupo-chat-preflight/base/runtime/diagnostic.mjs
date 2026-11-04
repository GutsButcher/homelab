import { APPLICATION_REASONS, unknownApplicationSample } from './application.mjs';

const HEADER = 'X-Hupo-State-Diagnostic';
const HASH = /^[a-f0-9]{64}$/;
const BOOLEANS = ['identityMatches', 'reportedHealthy', 'syncedExpected', 'idle'];
const KNOWN_REASONS = ['OBSERVED', 'REPORTED_UNHEALTHY', 'NOT_SYNCED', 'BUSY'];

export function stateDiagnosticHeaders(report, observation, producerSha256, now) {
  try {
    const at = Date.parse(report.observedAt);
    if (!observation || typeof producerSha256 !== 'string' || !HASH.test(producerSha256) ||
        typeof report.revision !== 'string' || !HASH.test(report.revision) || report.schemaVersion !== 1 ||
        report.fresh !== true || typeof report.nonce !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(report.nonce) ||
        !Number.isFinite(now) || !Number.isFinite(at) || at > now || now - at > 60000 ||
        new Date(at).toISOString() !== report.observedAt || ![null, 'node01'].includes(report.observedNode)) return {};
    const state = diagnosticObservation(observation, now);
    if (!state) return {};
    const record = { schemaVersion: 1, producerSha256, policyRevision: report.revision, nonce: report.nonce,
      observedAt: report.observedAt, observedNode: report.observedNode, capacity: state.capacity,
      application: state.application, phaseAdmissionVerified: false };
    const json = JSON.stringify(record);
    if (!/^[\x20-\x7e]+$/.test(json)) return {};
    const encoded = Buffer.from(json, 'ascii').toString('base64url');
    return Buffer.byteLength(encoded) <= 2048 ? { [HEADER]: encoded } : {};
  } catch { return {}; }
}

export function diagnosticObservation(value, now) {
  if (!value) return null;
  try {
    const deficit = value.capacity?.fullPolicyDeficitMi;
    const capacity = value.capacity?.state === 'KNOWN' && Number.isSafeInteger(deficit) && deficit >= 0 ?
      { state: 'KNOWN', fullPolicyDeficitMi: deficit } : { state: 'UNKNOWN', fullPolicyDeficitMi: null };
    const data = value.application;
    const validUntil = Number.isFinite(value.applicationValidUntil) ? value.applicationValidUntil : null;
    const reason = data?.state === 'UNKNOWN' && APPLICATION_REASONS.includes(data.reason) && !KNOWN_REASONS.includes(data.reason) ? data.reason : 'MALFORMED';
    let application = unknownApplicationSample(reason).application;
    const expectedReason = data && (!data.idle ? 'BUSY' : !data.reportedHealthy ? 'REPORTED_UNHEALTHY' : !data.syncedExpected ? 'NOT_SYNCED' : 'OBSERVED');
    if (data?.state === 'KNOWN' && BOOLEANS.every(key => typeof data[key] === 'boolean') && data.identityMatches && data.reason === expectedReason) {
      application = validUntil !== null && now <= validUntil ?
        { state: 'KNOWN', ...Object.fromEntries(BOOLEANS.map(key => [key, data[key]])), reason: data.reason } : unknownApplicationSample('STALE').application;
    }
    return { capacity, application, applicationValidUntil: validUntil };
  } catch { return null; }
}
