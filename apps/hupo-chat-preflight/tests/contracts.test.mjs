import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { plan } from './helpers.mjs';

async function document(path) {
  try { return JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

test('RBAC is read-only, exact-node constrained and has no secret, config or subresource access', async () => {
  const doc = await document('base/rbac.yaml');
  assert.ok(doc, 'RBAC source is missing');
  const rules = doc.items.find(x => x.kind === 'ClusterRole').rules;
  assert.deepEqual(rules, [
    { apiGroups: [''], resources: ['nodes'], resourceNames: ['node01'], verbs: ['get'] },
    { apiGroups: [''], resources: ['pods'], verbs: ['list'] },
    { apiGroups: ['metrics.k8s.io'], resources: ['nodes'], resourceNames: ['node01'], verbs: ['get'] }
  ]);
  const binding = doc.items.find(x => x.kind === 'ClusterRoleBinding');
  assert.deepEqual(binding.subjects, [{ kind: 'ServiceAccount', name: 'hupo-chat-preflight', namespace: 'hupo-chat-preflight' }]);
});

test('certificate reader access is a standalone exact-service GET Role in the existing controller namespace', async () => {
  const kustomization = await document('cert-reader-access/kustomization.yaml');
  assert.ok(kustomization, 'standalone certificate access source is missing');
  assert.deepEqual(kustomization, { apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization',
    namespace: 'sealed-secrets', resources: ['access.yaml'] });
  assert.deepEqual((await readdir(new URL('../cert-reader-access/', import.meta.url))).sort(), ['access.yaml', 'kustomization.yaml']);
  const access = await document('cert-reader-access/access.yaml');
  const name = 'hupo-chat-preflight-certificate-reader';
  const metadata = { name, namespace: 'sealed-secrets', annotations: { 'argocd.argoproj.io/sync-wave': '-20' } };
  assert.deepEqual(access, { apiVersion: 'v1', kind: 'List', items: [
    { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata,
      rules: [{ apiGroups: [''], resources: ['services/proxy'], resourceNames: ['sealed-secrets-controller:8080'], verbs: ['get'] }] },
    { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata,
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name },
      subjects: [{ kind: 'ServiceAccount', name: 'hupo-chat-preflight', namespace: 'hupo-chat-preflight' }] }
  ] });
  for (const path of ['kustomization.yaml', 'base/kustomization.yaml', 'prod/kustomization.yaml']) {
    const base = await document(path);
    assert.equal(JSON.stringify(base).includes('cert-reader-access'), false, 'cross-namespace access must not enter the preflight namespace transformer');
  }
});

test('certificate permission follows the preflight ServiceAccount and precedes its pod', async () => {
  const namespace = await document('base/namespace.yaml');
  const sa = await document('base/service-account.yaml');
  const deploy = await document('base/deployment.yaml');
  const access = await document('cert-reader-access/access.yaml');
  assert.equal(namespace.metadata.annotations['argocd.argoproj.io/sync-wave'], '-40');
  assert.equal(sa.metadata.annotations['argocd.argoproj.io/sync-wave'], '-30');
  assert.equal(deploy.metadata.annotations['argocd.argoproj.io/sync-wave'], '0');
  assert.equal(access.items.every(item => item.metadata.annotations['argocd.argoproj.io/sync-wave'] === '-20'), true);
});

test('workload is a tiny pinned non-root read-only container with only its own retained PVC and projected token', async () => {
  const deploy = await document('base/deployment.yaml');
  assert.ok(deploy, 'Deployment source is missing');
  const pod = deploy.spec.template.spec;
  assert.equal(pod.nodeSelector['kubernetes.io/hostname'], plan.targetNode);
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.serviceAccountName, 'hupo-chat-preflight');
  assert.equal(pod.containers.length, 1);
  assert.equal(pod.initContainers, undefined);
  assert.equal(pod.hostNetwork, undefined);
  assert.equal(pod.hostPID, undefined);
  assert.deepEqual(pod.securityContext, { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000,
    fsGroup: 1000, fsGroupChangePolicy: 'OnRootMismatch', seccompProfile: { type: 'RuntimeDefault' } });
  const c = pod.containers[0];
  assert.equal(c.image, 'node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c');
  assert.deepEqual(c.resources, { requests: { cpu: '10m', memory: '64Mi' }, limits: { cpu: '100m', memory: '128Mi' } });
  assert.deepEqual(c.securityContext, { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
  assert.equal(c.envFrom, undefined);
  assert.equal(c.env.find(e => e.name === 'NODE_NAME').valueFrom.fieldRef.fieldPath, 'spec.nodeName');
  assert.equal(c.volumeMounts.every(v => v.readOnly === true), true);
  assert.equal(pod.volumes.some(v => v.hostPath), false);
  assert.deepEqual(pod.volumes.filter(v => v.persistentVolumeClaim).map(v => v.persistentVolumeClaim.claimName), ['hupo-chat-preflight-disk']);
  assert.equal(c.readinessProbe.httpGet.path, '/healthz');
  assert.equal(c.livenessProbe.httpGet.path, '/healthz');
  const pvc = await document('base/pvc.yaml');
  assert.equal(pvc.spec.storageClassName, 'local-path');
  assert.equal(pvc.spec.resources.requests.storage, '1Mi');
  assert.equal(pvc.metadata.annotations['argocd.argoproj.io/sync-wave'], deploy.metadata.annotations['argocd.argoproj.io/sync-wave']);
  for (const item of [pvc, await document('base/namespace.yaml')]) {
    assert.match(item.metadata.annotations['argocd.argoproj.io/sync-options'], /Delete=false/);
    assert.match(item.metadata.annotations['argocd.argoproj.io/sync-options'], /Prune=false/);
  }
  const sa = await document('base/service-account.yaml');
  assert.equal(sa.automountServiceAccountToken, false);
  assert.equal(pod.volumes.filter(v => v.projected).length, 1);
});

test('ingress contains exactly two host/exact-path GET/HEAD routes and no root or TLS catchall', async () => {
  const route = await document('prod/ingressroute.yaml');
  assert.ok(route, 'Ingress source is missing');
  assert.equal(route.apiVersion, 'traefik.io/v1alpha1');
  assert.deepEqual(route.spec.entryPoints, ['web']);
  assert.equal(route.spec.tls, undefined);
  assert.deepEqual(route.spec.routes.map(r => r.match), [
    'Host(`n8n.gwynbliedd.com`) && Path(`/.well-known/hupo-chat-preflight`) && (Method(`GET`) || Method(`HEAD`))',
    'Host(`n8n.gwynbliedd.com`) && Path(`/.well-known/hupo-chat-sealing.pem`) && (Method(`GET`) || Method(`HEAD`))'
  ]);
  for (const rule of route.spec.routes) {
    assert.deepEqual(rule.services, [{ name: 'hupo-chat-preflight', port: 8080 }]);
  }
  const middlewares = await document('prod/middlewares.yaml');
  assert.deepEqual(middlewares.items.map(x => x.spec.replacePath.path), ['/report', '/certificate']);
});

test('network isolation admits only Traefik, DNS, explicit API addresses and the certificate controller', async () => {
  const doc = await document('base/network-policy.yaml');
  assert.ok(doc, 'NetworkPolicy source is missing');
  assert.deepEqual(doc.spec.podSelector, {});
  assert.deepEqual(doc.spec.policyTypes, ['Ingress', 'Egress']);
  assert.deepEqual(doc.spec.ingress, [{ from: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
    podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } } }], ports: [{ protocol: 'TCP', port: 8080 }] }]);
  assert.equal(doc.spec.egress.length, 4);
  assert.deepEqual(doc.spec.egress[0].ports, [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }]);
  assert.equal(doc.spec.egress[0].to[0].podSelector.matchLabels['k8s-app'], 'kube-dns');
  assert.deepEqual(doc.spec.egress[1], { to: [{ ipBlock: { cidr: '10.43.0.1/32' } }], ports: [{ protocol: 'TCP', port: 443 }] });
  assert.deepEqual(doc.spec.egress[2], { to: [{ ipBlock: { cidr: '192.168.100.191/32' } }, { ipBlock: { cidr: '192.168.100.229/32' } }],
    ports: [{ protocol: 'TCP', port: 6443 }] });
  const controller = doc.spec.egress[3];
  assert.deepEqual(controller.ports, [{ protocol: 'TCP', port: 8080 }]);
  assert.equal(controller.to[0].namespaceSelector.matchLabels['kubernetes.io/metadata.name'], 'sealed-secrets');
  assert.deepEqual(controller.to[0].podSelector.matchLabels,
    { 'app.kubernetes.io/name': 'sealed-secrets', 'app.kubernetes.io/instance': 'sealed-secrets' });
  const service = await document('base/service.yaml');
  assert.equal(service.spec.type, 'ClusterIP');
  assert.deepEqual(service.spec.ports, [{ name: 'http', port: 8080, targetPort: 8080, protocol: 'TCP' }]);
});
