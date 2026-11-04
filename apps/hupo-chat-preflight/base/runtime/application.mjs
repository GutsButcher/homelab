import { createHash } from 'node:crypto';

const PIN = '4b88cf5f984404cf0539811127dbe66cfd38c18a';
const SOURCE = { repoURL: 'https://github.com/GutsButcher/homelab.git', path: 'apps/hupo-chat/prod', targetRevision: PIN };
const DESTINATION = { server: 'https://kubernetes.default.svc', namespace: 'hupo-chat' };

const HEALTH = new Set(['Healthy', 'Progressing', 'Degraded', 'Missing', 'Suspended', 'Unknown']);
const SYNC = new Set(['Synced', 'OutOfSync', 'Unknown']);
export const APPLICATION_REASONS = Object.freeze(['OBSERVED', 'REPORTED_UNHEALTHY', 'NOT_SYNCED', 'BUSY',
  'DENIED', 'MISSING', 'STALE', 'MALFORMED', 'CHANGING', 'UNAVAILABLE', 'IDENTITY_MISMATCH', 'STATUS_UNKNOWN']);

export function applicationSample(data, now) {
  try {
    const { metadata, spec, status } = data;
    if (!metadata || !spec || !status || !token(metadata.uid) || !token(metadata.resourceVersion)) throw new Error('MALFORMED');
    if (data.apiVersion !== 'argoproj.io/v1alpha1' || data.kind !== 'Application' ||
        metadata.name !== 'hupo-chat' || metadata.namespace !== 'argocd' || metadata.deletionTimestamp != null || spec.project !== 'homelab' ||
        spec.sources !== undefined || Object.hasOwn(spec, 'sourceHydrator') ||
        !matches(spec.source, SOURCE) || !matches(spec.destination, DESTINATION)) throw new Error('IDENTITY_MISMATCH');
    const sync = status.sync;
    if (!HEALTH.has(status.health?.status) || !SYNC.has(sync?.status) || !revision(sync.revision) || !sync.comparedTo) throw new Error('MALFORMED');
    if (!matches(sync.comparedTo.source, SOURCE) || !matches(sync.comparedTo.destination, DESTINATION) ||
        sync.comparedTo.sources !== undefined || sync.revisions !== undefined) throw new Error('IDENTITY_MISMATCH');
    const reconciledAt = timestamp(status.reconciledAt, now);
    if (now - reconciledAt > 60000) throw new Error('STALE');
    if (status.health.status === 'Unknown' || sync.status === 'Unknown') throw new Error('STATUS_UNKNOWN');
    const operation = operations(data, now);
    const reportedHealthy = status.health.status === 'Healthy';
    const syncedExpected = sync.status === 'Synced' && sync.revision === PIN;
    const application = { state: 'KNOWN', identityMatches: true, reportedHealthy, syncedExpected, idle: operation.idle,
      reason: !operation.idle ? 'BUSY' : !reportedHealthy ? 'REPORTED_UNHEALTHY' : !syncedExpected ? 'NOT_SYNCED' : 'OBSERVED' };
    const relevant = { uid: metadata.uid, resourceVersion: metadata.resourceVersion, project: spec.project,
      source: SOURCE, destination: DESTINATION, health: status.health.status,
      sync: { status: sync.status, revision: sync.revision }, reconciledAt: status.reconciledAt, operation };
    return { application, signature: createHash('sha256').update(JSON.stringify(relevant)).digest('hex'), validUntil: reconciledAt + 60000 };
  } catch (error) { return unknownApplicationSample(error?.message); }
}

export function unknownApplicationSample(reason = 'UNAVAILABLE') {
  if (!APPLICATION_REASONS.includes(reason)) reason = 'MALFORMED';
  return { application: { state: 'UNKNOWN', identityMatches: null, reportedHealthy: null, syncedExpected: null, idle: null, reason },
    signature: null, validUntil: null };
}

export function bracketApplication(first, second, now) {
  if (first?.application?.state !== 'KNOWN') return first || unknownApplicationSample();
  if (second?.application?.state !== 'KNOWN') return second || unknownApplicationSample();
  if (!Number.isFinite(now) || now > Math.min(first.validUntil, second.validUntil)) return unknownApplicationSample('STALE');
  if (first.signature !== second.signature) return unknownApplicationSample('CHANGING');
  return second;
}

function operations(data, now) {
  const pending = data.operation !== undefined && data.operation !== null;
  if (pending) syncOperation(data.operation.sync);
  const state = data.status.operationState;
  if (state === undefined || state === null) return { idle: !pending, pending, state: null };
  if (!['Running', 'Terminating', 'Succeeded', 'Failed', 'Error'].includes(state.phase)) throw new Error('MALFORMED');
  syncOperation(state.operation?.sync);
  const started = timestamp(state.startedAt, now);
  const active = ['Running', 'Terminating'].includes(state.phase);
  if (!active || state.finishedAt !== undefined) {
    if (timestamp(state.finishedAt, now) < started || active) throw new Error('MALFORMED');
  }
  if (!active || state.syncResult !== undefined) {
    if (!revision(state.syncResult?.revision)) throw new Error('MALFORMED');
    if (state.syncResult.revision !== PIN || state.syncResult.revisions !== undefined ||
        (state.syncResult.source !== undefined && !matches(state.syncResult.source, SOURCE))) throw new Error('IDENTITY_MISMATCH');
  }
  return { idle: !pending && !active, pending,
    state: { phase: state.phase, startedAt: state.startedAt, finishedAt: state.finishedAt ?? null,
      revision: state.syncResult?.revision ?? null } };
}

function syncOperation(sync) {
  if (!revision(sync?.revision)) throw new Error('MALFORMED');
  if (sync.revision !== PIN || sync.revisions !== undefined ||
      (sync.source !== undefined && !matches(sync.source, SOURCE))) throw new Error('IDENTITY_MISMATCH');
}

function matches(value, expected) {
  return value && Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, entry]) => value[key] === entry);
}

function token(value) { return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value); }
function revision(value) { return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value); }
function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) throw new Error('MALFORMED');
  const at = Date.parse(value);
  if (!Number.isFinite(now) || !Number.isFinite(at) || at < 0 || new Date(at).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('MALFORMED');
  if (at - now > 5000) throw new Error('STALE');
  return at;
}
