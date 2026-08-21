# Argo CD configuration

This directory replaces the FluxCD control plane that used to live in `clusters/homelab/`
and `infrastructure/sources/`. Argo CD reconciles the cluster straight from `main`.

## Layout

```
argocd/
├── bootstrap/
│   ├── project.yaml         AppProject "homelab" (allowed repos + destinations)
│   └── root.yaml            app-of-apps that owns everything in applications/
├── applications/
│   ├── infrastructure/      sync-wave -2: cert-manager, cnpg, sealed-secrets
│   └── apps/                sync-wave  0: the workloads
└── parked/                  ready-made Applications that are deliberately NOT synced
```

## Bootstrap

Argo CD itself is installed manually in the `argocd` namespace (it is not self-managed).
To hand it the cluster:

```bash
kubectl apply -f argocd/bootstrap/project.yaml
kubectl apply -f argocd/bootstrap/root.yaml
```

The `root` Application watches `argocd/applications/` recursively, so from then on adding
an app is just committing a new `Application` manifest into that directory.

The git repository is public, so no repository credentials need to be registered.

## How an application is put together

Flux used a `HelmRelease` CR plus a Kustomize `patchesStrategicMerge` overlay. Argo CD has
no equivalent CR, so each Helm-backed app is a **multi-source Application**:

| Source | Purpose |
| --- | --- |
| `ref: values` | this git repo, referenced only so the Helm source can read `$values/...` |
| `path: apps/<app>/prod/<app>` | Kustomize dir: Namespace, SealedSecrets, CNPG `Cluster`, Traefik `IngressRoute` |
| `chart: <name>` | the upstream chart, with `valueFiles: [$values/apps/<app>/values.yaml]` |

The values that used to sit under `spec.values` of the HelmRelease now live in a plain
`values.yaml` next to the app (`apps/<app>/values.yaml`, `infrastructure/<component>/values.yaml`).

Apps with no Helm chart (kavita, n8n, rustfs, wallabag) are single-source Applications
pointing at their Kustomize directory.

## Chart versions are pinned

Flux resolved semver ranges (`>=12.4.0 <13.0.0`) on every reconcile. The Argo Applications
pin `targetRevision` to the exact chart version that was already running when the migration
happened, so the first sync adopts the live objects instead of upgrading them. Bump the
version in the Application manifest when you actually want an upgrade.

Two chart repositories moved and the old Flux `HelmRepository` URLs now 404:

| Chart | Old URL (dead) | Current URL |
| --- | --- | --- |
| `sealed-secrets` | `https://bitnami-labs.github.io/sealed-secrets` | `https://bitnami.github.io/sealed-secrets` |
| `vaultwarden` | `https://fmjstudios.github.io/helm` | `https://adnoctem.github.io/helm` |

## Sync policy

Every Application runs `automated: {prune: true, selfHeal: true}`, matching the old Flux
`prune: true`. `ServerSideApply=true` is set everywhere — cert-manager and
kube-prometheus-stack ship CRDs too large for the client-side
`last-applied-configuration` annotation.

`ignoreDifferences` entries exist for webhook `caBundle` fields, which cert-manager's
cainjector and the CNPG / prometheus-operator admission jobs write at runtime. Without
them `selfHeal` would overwrite the injected CA on every pass.

## Two things Argo CD must not manage

**Prometheus CRDs.** The `monitoring` Application sets `helm.skipCrds: true`. The CRDs in
this cluster were installed out-of-band and come from prometheus-operator **v0.83.0**,
while the running operator image and the bundled chart CRDs are **v0.65.1**. Letting Argo
CD own them would mean continuously downgrading CRDs underneath live `Prometheus` and
`ServiceMonitor` objects. CRD upgrades stay a manual step here.

**The gitea postgres password.** The bitnami postgresql subchart generates
`Secret/gitea-postgresql` with `randAlphaNum`, and normally keeps it stable by `lookup`-ing
the Secret that already exists. Argo CD's repo-server renders without cluster access, so
`lookup` returns nothing and a *new* password appears on every render — permanently
OutOfSync, and a sync would rotate the password out from under the running gitea. The
`gitea` Application therefore carries an `ignoreDifferences` entry for that Secret's
`/data`, which `RespectIgnoreDifferences=true` also honours during sync.

Any other chart that generates its own credentials will need the same treatment.

## Leftovers from Flux

The old `sh.helm.release.v1.*` secrets are still in the cluster. Argo CD does not use them
and they are harmless, but they make `helm list` show releases nothing manages any more.
Once you are happy the migration has settled, they can be removed:

```bash
kubectl get secret -A -l owner=helm
# kubectl delete secret -n <ns> -l owner=helm,name=<release>
```

Likewise, the `helm.toolkit.fluxcd.io/name` and `kustomize.toolkit.fluxcd.io/name` labels
on live objects are dropped the first time Argo CD applies each resource.
