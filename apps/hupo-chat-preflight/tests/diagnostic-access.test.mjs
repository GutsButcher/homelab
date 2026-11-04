import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

async function document(path) {
  try { return JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

test('state access is an inert standalone argocd Role GET only for hupo-chat using the existing P0 identity', async () => {
  const config = await document('state-reader-access/kustomization.yaml');
  assert.ok(config, 'standalone state-reader-access is missing');
  assert.deepEqual(config, { apiVersion: 'kustomize.config.k8s.io/v1beta1', kind: 'Kustomization', namespace: 'argocd', resources: ['access.yaml'] });
  assert.deepEqual((await readdir(new URL('../state-reader-access/', import.meta.url))).sort(), ['access.yaml', 'kustomization.yaml']);
  const name = 'hupo-chat-preflight-state-reader';
  const metadata = { name, namespace: 'argocd', annotations: { 'argocd.argoproj.io/sync-wave': '-20' } };
  assert.deepEqual(await document('state-reader-access/access.yaml'), { apiVersion: 'v1', kind: 'List', items: [
    { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'Role', metadata,
      rules: [{ apiGroups: ['argoproj.io'], resources: ['applications'], resourceNames: ['hupo-chat'], verbs: ['get'] }] },
    { apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'RoleBinding', metadata,
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name },
      subjects: [{ kind: 'ServiceAccount', name: 'hupo-chat-preflight', namespace: 'hupo-chat-preflight' }] }
  ] });
  for (const path of ['kustomization.yaml', 'base/kustomization.yaml', 'prod/kustomization.yaml', 'cert-reader-access/kustomization.yaml']) {
    assert.equal(JSON.stringify(await document(path)).includes('state-reader-access'), false, path + ' must not activate or transform cross-namespace access');
  }
});
