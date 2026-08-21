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

**Prometheus CRDs on a major chart bump.** Argo CD computes its diff using the CRD
schema *already in the cluster*. When kube-prometheus-stack was moved from chart 45.31.1
to 88.5.3, the rendered `Prometheus` CR used fields the live v0.83.0 CRD did not declare,
so the app failed with:

```
ComparisonError: failed to calculate diff: error calculating structured merge diff:
error building typed value from config resource: .spec.hostNetwork: field not declared
```

That is a deadlock — Argo CD will not sync (which would update the CRD) until it can
diff, and it cannot diff until the CRD is updated. Apply the chart's CRDs by hand first,
then let Argo CD take over:

```bash
helm pull kube-prometheus-stack --repo https://prometheus-community.github.io/helm-charts \
  --version <new-version> --untar --untardir /tmp/kps
kubectl apply --server-side --force-conflicts -f /tmp/kps/kube-prometheus-stack/charts/crds/crds/
kubectl annotate application monitoring -n argocd argocd.argoproj.io/refresh=hard --overwrite
```

`--server-side` is required: these CRDs are up to 813 KB and blow past the client-side
`last-applied-configuration` annotation limit. Expect to repeat this on the next major bump.

**The gitea postgres password.** The bitnami postgresql subchart generates
`Secret/gitea-postgresql` with `randAlphaNum`, and normally keeps it stable by `lookup`-ing
the Secret that already exists. Argo CD's repo-server renders without cluster access, so
`lookup` returns nothing and a *new* password appears on every render — permanently
OutOfSync, and a sync would rotate the password out from under the running gitea. The
`gitea` Application therefore carries an `ignoreDifferences` entry for that Secret's
`/data`, which `RespectIgnoreDifferences=true` also honours during sync.

**Grafana's admin password** had the same problem and is solved properly rather than
ignored: `grafana.admin.existingSecret` points at the `grafana-admin` SealedSecret in
`apps/monitoring/prod/prometheus/`, which was sealed from the password already in the
cluster. With `existingSecret` set the chart renders neither its own Secret nor the
`checksum/secret` pod annotation derived from it, so the output is byte-stable across
renders — verified by rendering twice and diffing.

Any other chart that generates its own credentials will need one of these two treatments.
Prefer the `existingSecret` + SealedSecret route: `ignoreDifferences` leaves the repo
describing something other than what is running.

## Leftovers from Flux

Swept on 2026-08-21:

- The `sh.helm.release.v1.*` secrets from the Flux era were deleted. Argo CD does not use
  them; they only made `helm list` show releases nothing manages any more.

  **Do not sweep the `kube-system` `traefik` and `traefik-crd` releases with them** — they
  are not Flux leftovers. k3s owns Traefik through its own `HelmChart` CRs and its
  helm-controller needs that release history. They were deleted by accident during this
  sweep (a filter written for `namespace/name` against `kubectl --no-headers`, which
  prints space-separated columns, so the exclusion silently matched nothing) and had to be
  rebuilt by adopting the live objects:

  ```bash
  kubectl get --raw /static/charts/traefik-34.2.1+up34.2.0.tgz > traefik.tgz
  kubectl get helmchart traefik -n kube-system -o jsonpath='{.spec.valuesContent}' > traefik-values.yaml
  helm upgrade --install traefik ./traefik.tgz -n kube-system --take-ownership \
    --set-string global.systemDefaultRegistry= -f traefik-values.yaml
  ```

  `--take-ownership` (Helm 3.17+) adopts the running objects instead of failing on
  "already exists". This was a no-op apply — the Traefik pod was not restarted. Note that
  the k3s install Job runs with `FAILURE_POLICY=reinstall`, so a *failed* run of it would
  uninstall and reinstall Traefik, taking ingress down with it.
- A dead `prometheus-stack` release (a kube-prometheus-stack install predating the current
  one) still had 4 ClusterRoles, 4 ClusterRoleBindings, 6 `kube-system` Services and a
  pair of admission webhooks pointing at a Service that no longer existed. All removed.

Still outstanding: many live objects carry `kustomize.toolkit.fluxcd.io/*` and
`helm.toolkit.fluxcd.io/*` labels. These do **not** disappear on their own — Argo CD
applies server-side, and server-side apply only removes fields its own field manager owns.
Flux set those labels under a different manager, so they persist until stripped by hand:

```bash
kubectl label <resource> <name> -n <ns> \
  kustomize.toolkit.fluxcd.io/name- kustomize.toolkit.fluxcd.io/namespace- \
  helm.toolkit.fluxcd.io/name- helm.toolkit.fluxcd.io/namespace-
```

They are cosmetic — nothing selects on them — but they make the cluster look like Flux is
still involved.
