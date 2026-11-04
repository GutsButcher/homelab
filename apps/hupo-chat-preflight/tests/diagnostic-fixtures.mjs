import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { now, inputs } from './helpers.mjs';

export const pin = '4b88cf5f984404cf0539811127dbe66cfd38c18a';
export const source = { repoURL: 'https://github.com/GutsButcher/homelab.git', path: 'apps/hupo-chat/prod', targetRevision: pin };
export const destination = { server: 'https://kubernetes.default.svc', namespace: 'hupo-chat' };
export const known = { state: 'KNOWN', identityMatches: true, reportedHealthy: true, syncedExpected: true, idle: true, reason: 'OBSERVED' };
export function unknown(reason) {
  return { state: 'UNKNOWN', identityMatches: null, reportedHealthy: null, syncedExpected: null, idle: null, reason };
}
export function application() {
  return { apiVersion: 'argoproj.io/v1alpha1', kind: 'Application',
    metadata: { namespace: 'argocd', name: 'hupo-chat', uid: 'application-fixture-uid', resourceVersion: '42' },
    spec: { project: 'homelab', source: { ...source }, destination: { ...destination } },
    status: { health: { status: 'Healthy' }, reconciledAt: new Date(now).toISOString(),
      sync: { status: 'Synced', revision: pin, comparedTo: { source: { ...source }, destination: { ...destination } } } } };
}
export const pem = rootCertificates.find(text => {
  const cert = new X509Certificate(text);
  const key = cert.publicKey;
  return key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails.modulusLength >= 2048 &&
    key.asymmetricKeyDetails.modulusLength <= 8192 && key.asymmetricKeyDetails.publicExponent >= 65537n &&
    Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo);
});
export function provider(reader = {}) {
  return { reader: { readInputs: async () => inputs(), ...reader }, readDisk: async () => inputs().disk,
    readCert: async () => pem, clock: () => now };
}
export function invoke(handler, method = 'GET', url = '/report') {
  const result = {};
  handler({ method, url, headers: { authorization: 'secret-canary', 'x-hupo-state-diagnostic': 'secret-canary' } }, {
    writeHead(status, headers) { result.status = status; result.headers = headers; }, end(body) { result.body = body; }
  });
  return result;
}
