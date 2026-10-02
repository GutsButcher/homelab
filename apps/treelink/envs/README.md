# Staging and production overlays (skeleton, not wired into Argo CD)

**Status: NOT TO BE MERGED/SYNCED until the owner decides D-16 and provides the inputs below.**
See `docs/ENGINEERING_QUEUE.md` (treelink repo) for D-16: "Production infrastructure (staging +
production tiers, `docs/ENVIRONMENTS.md`)" — still in the "Later / decision-blocked" table as of
2026-10-02. Nothing here is referenced by `apps/treelink/kustomization.yaml` (which still only
builds `prod/`, the dev tier) or by any Argo CD `Application`. `kubectl kustomize` renders every
file in this tree correctly (verified locally, see "Validated" below); nothing has ever been
`kubectl apply`'d.

This exists so that "stand up production infrastructure" is an **engineering-prepared, owner-
executable step**: a checklist of real inputs to provide and two commands to run, instead of a
blank page. It does not create any cloud account, cluster, database, bucket, or DNS record, and it
does not change anything in `apps/treelink/base/` or `apps/treelink/prod/` (the dev tier keeps
working exactly as it does today, untouched).

Companion docs in the treelink repo (branch `docs/production-safeguards`):
`docs/ENVIRONMENTS.md` (what "production" means as a release tier and what gates a release there),
`docs/LAUNCH-GATES.md` (the full production-readiness checklist, gate by gate), and
`docs/infra/production-provisioning.md` (the step-by-step runbook that uses everything in this
directory). Read those alongside this file, not instead of it.

## What is here

```
apps/treelink/envs/
  README.md                        this file
  _components/hardening/           shared Kustomize Component: everything staging and production
                                    need that the dev-tier base does not (web NetworkPolicy, PDBs,
                                    HPA, read-only root filesystem, sslmode=require wiring, and the
                                    deletion of the dev cluster's SealedSecrets — see below)
  staging/                         kustomization.yaml + patches + placeholder secrets/config
  production/                      same shape, instances: 2, min 2 replicas, digest-pinned images
  argocd/                          example Application manifests, NOT referenced by anything
```

Both `staging/` and `production/` build from `../../base` (the same base the dev tier uses) plus
the `_components/hardening` component, so a change to the real workload — a new env var, a block
type, a probe path — lands in all three environments by editing `base/` once, the way Kustomize is
meant to work. Only sizing, secrets, networking and the image reference differ per environment.

## Design decisions this skeleton makes (and the one it deliberately does not)

- **One cluster or two?** This skeleton assumes staging and production are **separate clusters**
  (the Argo CD `Application` examples in `argocd/` each have their own `destination.server`), both
  using the namespace `treelink` — so nothing in `base/` or the hardening component needs a
  namespace rename. If the owner instead puts staging and production in the same cluster, every
  manifest here still applies, but the two overlays need `namespace: treelink-staging` /
  `namespace: treelink-production` added to their `kustomization.yaml` (a one-line change each —
  Kustomize's top-level `namespace:` field overrides every resource's namespace even though they
  set it explicitly in `base/`) and the NetworkPolicy's `cnpg.io/cluster`/`app` podSelectors need
  nothing extra since they are already namespace-scoped by the Kubernetes NetworkPolicy API. Not
  done here because which one is right depends on the cloud provider/budget, which is D-16 itself.
- **CNPG stays the database engine**, now with `instances: 2` (production) and TLS-only `pg_hba`,
  rather than switching to a provider-managed Postgres (RDS/Cloud SQL/etc.). If the owner's D-16
  decision is a managed database instead, delete `patch-cnpg.yaml` and the `Cluster`/`Database`
  resources inherited from `base/`, and point `treelink-db-url`/`treelink-media-secrets`'
  `DATABASE_URL` at the managed instance instead — nothing else in this overlay changes.
  `docs/infra/production-provisioning.md` lists both paths.
  - **Where production observability lives is an explicit OWNER DECISION**, not assumed here: a
  managed Grafana Cloud / managed OTLP backend, or a second, independent LGTM install. The
  homelab's `lgtm-alloy` is development-only and does not extend to this infrastructure. Both
  `Instrumentation` CRs (`staging/patch-instrumentation.yaml`, `production/patch-instrumentation.yaml`)
  point at one `REPLACE_ME` endpoint each; see `docs/infra/production-provisioning.md` for the
  trade-off written out.
- **Ingress: tunnel vs. load balancer.** Both `ingress-cloudflare-tunnel.yaml` and
  `ingress-loadbalancer.yaml` exist in each env directory; exactly one is listed (uncommented) in
  that env's `kustomization.yaml` — today that is the tunnel, because it is the lowest-risk choice
  (no public IP to firewall, matches the dev tier's existing pattern) and because it still needs
  nothing from a cluster bootstrap (no ingress controller, no cert-manager). Comment it out and
  uncomment the other file to switch. **Staging and production must make the same choice** — the
  whole point of rehearsing DNS/TLS/edge rules in staging is that it proves the production path.
- **Image promotion is asymmetric on purpose.** Staging's `kustomization.yaml` pins `newTag:` (a
  CI-built `sha-<commit>`, the latest green build — TDR-0003 §G: "every merge to main deploys via
  GitOps"). Production's pins `digest:` (a `sha256:...` copied from the exact image that passed
  every staging gate — TDR-0003 §G: "promoted by image digest through a GitOps PR from Staging
  after green gates and a manual approval"). Never rebuild for production; never promote a tag.

## "Owner fills" — every placeholder in this directory, in one table

Every value below reads `REPLACE_ME` in git. None of them is guessed at or invented; where a
reasonable default exists (bucket name, HPA thresholds) it is called out as a suggestion, not a
requirement.

| # | What | Exact name / where | Used by | Notes |
| --- | --- | --- | --- | --- |
| 1 | **Zone / hostname** | `patch-hostnames.yaml` (`APP_URL`), `ingress-cloudflare-tunnel.yaml` or `ingress-loadbalancer.yaml` (`host`/`TLS`), Turnstile widget hostname | web Deployment, edge | One hostname per environment, e.g. `staging.treelink.<domain>` and `treelink.<domain>` (or whatever the owner's brand domain is). Must be a zone the owner controls in Cloudflare (`docs/CLOUDFLARE-PRODUCTION.md`). |
| 2 | **Tunnel token** (if Option A, the default) | `ingress-cloudflare-tunnel.yaml`, Secret `treelink-cloudflare-tunnel` key `TUNNEL_TOKEN` | `cloudflared` Deployment | Created once per environment in the Cloudflare Zero Trust dashboard (Networks → Tunnels), same manual step `docs/DEPLOYMENT.md` "First-time setup" describes for the dev tier. Never share one token between staging and production. |
| 2′ | **LB IP / Ingress class / cert-manager issuer** (if Option B instead) | `ingress-loadbalancer.yaml` | Ingress | Only relevant if the owner switches to Option B; depends on the cluster bootstrap's ingress controller and cert-manager install. |
| 3 | **Registry pull secret** | `secrets-placeholder.yaml`, Secret `gitea-registry` key `.dockerconfigjson` | web + media Deployments (`imagePullSecrets`) | Can stay the existing Gitea registry (`gitea.gwynbliedd.com`, a token scoped `read:package`, same shape as the dev tier's) or move to a different registry — the key name and shape do not change either way. |
| 4 | **Sealed-secrets key for the new cluster** | n/a (operational step, not a file here) | every `*-placeholder.yaml` Secret in `staging/` and `production/` | The sealed-secrets controller must be installed on the new cluster FIRST (`docs/infra/production-provisioning.md` step 1); then `kubeseal --fetch-cert` against it, then reseal every placeholder Secret listed in this table as a real `SealedSecret` with the same name/namespace/keys, and delete the plaintext placeholder file. Until then these stay plain `Secret` objects that must never be applied with real values inside this repo. |
| 5 | **SMTP** | `secrets-placeholder.yaml`, Secret `treelink-secrets` keys `SMTP_URL`, `MAIL_FROM` | web Deployment | A real transactional provider with SPF/DKIM/DMARC on the sending domain (`docs/EXTERNAL-INPUTS.md`) — not MailHog/Mailpit, which are dev/CI-only sinks. REQUIRED BEFORE LAUNCH per `docs/PRODUCTION-READINESS.md` §1/§8. |
| 6 | **Turnstile** | `secrets-placeholder.yaml`, Secret `treelink-secrets` keys `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | web Deployment | One Cloudflare Turnstile widget per hostname (row 1). REQUIRED BEFORE LAUNCH. |
| 7 | **Telegram (alerting)** | *not a file in this repo* — `~/.config/lgtm/telegram.env` + `make alerting-seal` in the private `lgtm-alloy` repo | Mimir Alertmanager | Listed here because it is on the owner-fills list for ANY tier (`docs/EXTERNAL-INPUTS.md`), but it lives in the observability stack, not in this overlay. If production observability is a second LGTM install (see "Design decisions" above), this step repeats there; if it is a managed backend, its own alerting/notification channel replaces this row entirely. |
| 8 | **S3 (uploads + backups)** | `object-storage-config.yaml` (`S3_ENDPOINT`/`S3_REGION`/`S3_FORCE_PATH_STYLE`), `media-secrets-placeholder.yaml` (media bucket + key), `backup-s3-secret-placeholder.yaml` (database + uploads backup bucket + key) | media Deployment, CNPG `Cluster.spec.backup` | **Three separate buckets, three separate scoped credentials, per environment**: the media bucket (suggested `treelink-media-staging`/`treelink-media-production`), the database backup bucket (`patch-cnpg.yaml` `destinationPath`), and — unlike the dev tier, which reuses one RustFS root credential for both (`docs/BACKUPS.md` "Failure modes") — give each its own least-privilege key. Never reuse a staging key or bucket for production. |
| 9 | **Database connection string** | `db-url-secret.yaml`, Secret `treelink-db-url` key `DATABASE_URL`; `media-secrets-placeholder.yaml` key `DATABASE_URL` | web + media Deployments | Built by the provisioning runbook AFTER CNPG creates `treelink-db-app`/the media role's password: `postgres://<user>:<password>@<cnpg-rw-host>:5432/<dbname>?sslmode=require`. See `patch-web-db-url-env.yaml` for why this is a separate secret from CNPG's own. |
| 10 | **SESSION_SECRET / ENCRYPTION_KEYS** | `secrets-placeholder.yaml` | web Deployment | Generate fresh per cluster (`openssl rand -hex 32` / `docs/SECURITY.md` keyring format). Never copy the homelab's values — a fresh cluster should start with its own, there is nothing to migrate. |
| 11 | **Observability backend** | `patch-instrumentation.yaml` (`exporter.endpoint`) | both `Instrumentation` CRs | OWNER DECISION, not a credential: managed Grafana Cloud vs. a second LGTM install. See "Design decisions" above and `docs/infra/production-provisioning.md`. |
| 12 | **Image digest (production only)** | `production/kustomization.yaml` `images[].digest` | web + media Deployments | Copied from the exact image staging ran through every gate in `docs/LAUNCH-GATES.md` — never rebuilt, never a tag. |
| 13 | **Argo CD cluster registration + destination server** | `argocd/treelink-staging.yaml`, `argocd/treelink-production.yaml` | Argo CD `Application` | The new cluster(s) must be registered with whichever Argo CD instance will manage them before these examples mean anything; see the comments in each file. |
| 14 | **WEB_RISK_API_KEY** (optional) | `secrets-placeholder.yaml` | web Deployment | Optional — the app runs on heuristics/blocklists without it (`docs/EXTERNAL-INPUTS.md`). |

## What changed relative to the dev tier, and why (cross-reference to the task's hardening list)

- **Web + media Deployments, Services, HPA**: inherited from `base/`; the hardening component adds
  an HPA for web (there is none in the dev tier — it is pinned to one replica by the RWO uploads
  volume) and raises the media HPA's floor to 2 in production (`patch-media-hpa.yaml`).
- **NetworkPolicies incl. a NEW web-tier NetworkPolicy**: `_components/hardening/networkpolicy-web.yaml`.
  Closes the gap `docs/PRODUCTION-READINESS.md` §3 calls out: "a NetworkPolicy for the web tier" was
  open; only the media service had one. Egress is intentionally broad (DNS, the database, the media
  service, telemetry, and arbitrary HTTPS/SMTP) because the web tier is still the monolith — see the
  comment in that file for exactly why and what narrows it later.
- **PDBs for web and media**: `_components/hardening/pdb-web.yaml`, `pdb-media.yaml`. Neither exists
  in the dev tier (single replica, nothing to disrupt).
- **`readOnlyRootFilesystem: true` with `emptyDir` mounts for `/tmp` and `.next/cache`**: the media
  service already has this in the dev tier; the web tier does not, because of the uploads volume
  (`base/treelink/deployment.yaml` comment: "Restricted profile except the root filesystem"). Traced
  from the `Dockerfile` (`WORKDIR /app`, `.next/cache` not copied into the image, so Next's built-in
  image-optimization cache writes there at runtime relative to that cwd) and `next.config.ts` (no
  `images.unoptimized`, confirming the image-optimization cache is active). `patch-web-stateless.yaml`
  in the hardening component.
- **`automountServiceAccountToken: false`**: already true in `base/` for both Deployments; carried
  through unchanged, listed here only because the task asked for it to be verified.
- **Placeholder SealedSecrets with the exact key names required**: see "Owner fills" row 4 and the
  per-env `*-placeholder.yaml` files. They are plain `Secret` objects with `REPLACE_ME` values, not
  SealedSecrets with fabricated ciphertext — a `SealedSecret.spec.encryptedData` value has to be
  real ciphertext from a real controller key to mean anything; a placeholder one would be actively
  misleading. Each file says explicitly how to turn it into a real SealedSecret (owner-fills row 4).
- **CNPG `Cluster` for production with `instances: 2`, TLS enabled**: `production/patch-cnpg.yaml`.
  `sslmode=require` in the `DATABASE_URL` construction: `_components/hardening/db-url-secret.yaml` +
  `patch-web-db-url-env.yaml` (see "Owner fills" row 9 for why this could not just be CNPG's
  auto-generated secret as-is). Backup to an object store with a scoped credential secret:
  `backup-s3-secret-placeholder.yaml` per env, referenced from `patch-cnpg.yaml`.
- **Instrumentation CRs named per deployment**: already true in `base/` (`nodejs` for web,
  `nodejs-media` for media); carried through, exporter endpoint patched per env (owner-fills row 11).
- **The `treelink-media` bucket and object-storage secret placeholders**: `media-secrets-placeholder.yaml`
  (bucket name + credentials) and `object-storage-config.yaml` (endpoint/region) per env.
- **Resource requests/limits**: inherited from `base/` unchanged (the task did not ask for different
  numbers, and this skeleton has no load data for infrastructure that does not exist yet — set real
  values from the first load test on staging, `npm run load`).
- **Ingress via either Cloudflare Tunnel or LB, documented choice, both files present**: see "Design
  decisions" above; `ingress-cloudflare-tunnel.yaml` active, `ingress-loadbalancer.yaml` commented
  out in each env's `kustomization.yaml`.

## Validated

```
$ kubectl version --client
Client Version: v1.34.1+k3s1
Kustomize Version: v5.7.1

$ kubectl kustomize apps/treelink/envs/staging    > /dev/null && echo OK
OK
$ kubectl kustomize apps/treelink/envs/production > /dev/null && echo OK
OK
```

This is a pure local YAML render (`kubectl kustomize` does not contact a cluster; no
`kubeconfig`/context is used or required). It confirms every `kustomization.yaml`, Component,
patch and resource in this tree is syntactically valid and resolves against `base/` — it does NOT
confirm the resulting manifests are valid against a live API server (CRD schemas for `Cluster`,
`Instrumentation`, `SealedSecret` are not installed in this environment to check against), and it
obviously does not confirm anything about the infrastructure these manifests assume exists. Both
renders produce the identical 32-object set (`grep -c '^kind:'`), the same 13 distinct kinds with
the same counts each (1 Namespace, 2 ConfigMap, 1 CronJob, 1 CNPG Database, 3 Deployment incl.
`cloudflared`, 2 HorizontalPodAutoscaler, 2 Instrumentation, 5 NetworkPolicy, 3
PodDisruptionBudget, 1 CNPG Cluster, 1 ScheduledBackup, 8 Secret, 2 Service) — staging and
production really do differ only in sizing, secrets content and the image reference, as intended.

Re-run after any change: `cd ~/homelab && kubectl kustomize apps/treelink/envs/staging` /
`.../production` from the repo root (or the worktree root, if run from one).

## What this is NOT

- Not an Argo CD wiring change. Nothing in `apps/treelink/kustomization.yaml` or
  `argocd/applications/apps/treelink.yaml` (the dev-tier Application) is touched.
- Not a secret. Every `Secret`/`SealedSecret`-shaped file here holds only the string `REPLACE_ME`.
- Not a decision about cloud provider, one cluster vs. two, or self-hosted vs. managed Postgres/
  observability — those are D-16 and are called out explicitly above and in
  `docs/infra/production-provisioning.md`, never assumed silently.
- Not a change to `scripts/infra/*` in the treelink repo — `TIER=production` there still refuses to
  run (`docs/ENVIRONMENTS.md`), by design, until the safeguards in that file are implemented.
