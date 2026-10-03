# ci-runner

Self-hosted GitHub Actions runner for the private repo `GutsButcher/treelink`, on `node01`.
Owner-approved; GitHub-hosted Actions minutes are exhausted for this account (2,000/month
budget). This is the no-cost path: treelink's own CI workflow (`.github/workflows/ci.yml` on
`main`; PR #105 / branch `ci/runner-switch` adds the self-hosted-specific cleanup steps) already
supports switching to it via the `CI_RUNNER_LABELS` repository variable — nothing in treelink
needs to change to use this runner once it is registered.

Merging the PR that adds this application deploys it: Argo CD's root app-of-apps auto-syncs
`main` (`argocd/bootstrap/root.yaml`, `prune: true` + `selfHeal: true`). This README does not
get merged automatically — a human merges it, per the homelab's own rule.

## What's here

- `namespace.yaml` — namespace `ci-runner`.
- `base/serviceaccount.yaml` — dedicated ServiceAccount, no RBAC bound to it, token not
  auto-mounted.
- `base/pvc.yaml` — 20Gi on `local-path` (this cluster's default StorageClass), backing the
  runner's `_work` directory, its npm/Playwright cache, and its registration state.
- `base/registration-secret.yaml` — a SealedSecret whose `RUNNER_TOKEN` currently decrypts to
  the literal string `PLACEHOLDER`. See "Owner steps" below — this must be resealed with a real
  token before the runner can register.
- `base/entrypoint-configmap.yaml` — the two containers' entrypoint scripts (registration +
  persistence logic for the runner container, docker-socket bring-up for the dind sidecar).
- `base/networkpolicy.yaml` — default-deny ingress; egress limited to DNS, the Gitea registry
  (in-cluster), and the internet on 80/443.
- `base/deployment.yaml` — the runner + dind pod. See "Privileged dind" below.

## Privileged dind: risk and why it's acceptable here

The `dind` sidecar runs with `securityContext.privileged: true`. That is full access to the
node's devices and kernel from inside the container — in practice, root on `node01` for anyone
who can get a workflow step to run on this runner. This is the single biggest risk in this PR.

Why it's accepted in this (development-tier) cluster:

- The repo is **private**, and only the owner can trigger workflow runs against it (no public
  PRs from strangers land on this runner the way they could on a public repo — the classic
  self-hosted-runner abuse case).
- There is no narrower way to get a general-purpose Docker daemon (`services:` containers,
  `docker build`/buildx, the `semgrep/semgrep` job container, arbitrary `docker run`) inside a
  Kubernetes pod. Rootless Docker-in-Docker and alternatives like Kaniko/sysbox were not pursued
  here — they would need workflow changes (Kaniko has no `docker run`/`services:` support),
  which is out of scope for infra-only work in this PR.
- This cluster is the explicitly-documented development tier (treelink's
  `docs/ENVIRONMENTS.md`); a future production tier is separate infrastructure with its own
  gates. A compromised CI job on `node01` can reach other development-tier workloads on that
  node (see NetworkPolicy and resource sizing below) but not a production system, because none
  exists yet.
- Blast radius is bounded by what's already on `node01`: nothing in this cluster currently
  treats `node01` as a security boundary stronger than "development tier."

If this is not acceptable, the alternative is to not run `services:`/`docker build` workloads
on a self-hosted runner at all (keep using `ubuntu-latest` for the `check`/`media`/`image` jobs
and only move something that doesn't need Docker here) — but that defeats the purpose, since
those are the jobs consuming the Actions-minutes budget.

## node01 headroom (measured 2026-10-03)

```
$ kubectl describe node node01   # Capacity / Allocatable
cpu: 4, memory: 16259588Ki (~15.9Gi)

$ kubectl describe node node01   # Allocated resources, before this app
cpu      2755m requested (68%) / 2500m limits (62%)
memory   9956Mi requested (62%) / 30464Mi limits (191%, already overcommitted)

$ kubectl top node node01
cpu 1840m (46% actual use), memory 10425Mi (65% actual use)
```

This app adds **850m cpu / 4Gi memory** in requests (runner 600m/3Gi + dind 250m/1Gi) and
**4 cpu / 8Gi memory** in limits (runner 3/6Gi + dind 1/2Gi). After it:

- cpu requests: 3605m / 4000m = **90%** (395m headroom left — tight; this was sized down from
  the originally proposed 1cpu+0.5cpu=1.5cpu because the node only had ~1.25cpu of request
  headroom to begin with)
- memory requests: 14052Mi / 15878Mi = **88%** (≈1.8Gi headroom left)
- cpu limits: 6500m = 162% of capacity (overcommitted, consistent with this node's existing
  191% memory-limit overcommit — fine because limits are a ceiling, not a reservation; actual
  usage is what `kubectl top` shows, 46%/65% today)

If another workload later needs to schedule on `node01` and does not fit, trim this
Deployment's `requests` first (the `limits` give CI bursts room; the `requests` are what is
reserved whether or not the runner is busy).

## Owner steps: first registration

1. Merge this PR. Argo CD creates the namespace and everything in it except a usable runner —
   the pod will crash-loop on `config.sh` until step 2, because the SealedSecret currently
   decrypts to `RUNNER_TOKEN=PLACEHOLDER`.
2. Generate a real registration token (expires in 1 hour):
   ```bash
   gh api -X POST repos/GutsButcher/treelink/actions/runners/registration-token --jq .token
   ```
3. Reseal the secret with the real token and apply it directly (faster than a commit/PR round
   trip for a token that expires in an hour):
   ```bash
   kubectl create secret generic ci-runner-registration -n ci-runner \
     --from-literal=RUNNER_TOKEN=<token from step 2> --dry-run=client -o yaml \
     | kubeseal --fetch-cert --controller-namespace sealed-secrets \
         --controller-name sealed-secrets-controller --format=yaml \
     | kubectl apply -f -
   ```
   (Optionally also commit the resealed `base/registration-secret.yaml` afterwards so the repo
   stops saying `PLACEHOLDER` — not required for the runner to work, since the applied Secret in
   the cluster is what the pod actually reads.)
4. Restart the pod so it picks up the new secret and registers:
   ```bash
   kubectl rollout restart deployment/ci-runner -n ci-runner
   kubectl logs -n ci-runner deploy/ci-runner -c runner -f
   ```
   Look for `ci-runner: no registration found on the PVC; registering homelab-node01-1`,
   followed by `√ Connected to GitHub` from `config.sh`. The runner then shows up at
   https://github.com/GutsButcher/treelink/settings/actions/runners as `homelab-node01-1`
   (idle), with labels `self-hosted, linux, x64, homelab`.
5. Point CI at it: in the treelink repo, set the repository variable
   `CI_RUNNER_LABELS` to `["self-hosted","linux","x64","homelab"]` (Settings → Secrets and
   variables → Actions → Variables). Every workflow using the shared `runs-on` expression picks
   it up on its next run; no workflow file changes.
6. The registration token is not needed again: after the first successful `config.sh`, the
   entrypoint moves `.runner`/`.credentials*` onto the PVC (`_work/.runner-state`) and symlinks
   them back, so a future pod restart skips registration entirely.

## Pause

```bash
kubectl scale deployment/ci-runner -n ci-runner --replicas=0
```
Falls back to `ubuntu-latest` automatically for any workflow run that starts while the runner is
down and no runner with a matching label is online — GitHub queues the job if `CI_RUNNER_LABELS`
is still set and no matching runner is available; for a clean fallback, also unset
`CI_RUNNER_LABELS` (see Rollback).

## Rollback

- **Stop using it, keep it deployed:** unset the `CI_RUNNER_LABELS` repository variable in
  treelink (or set it to `["ubuntu-latest"]`). Every workflow goes back to GitHub-hosted on its
  next run; no workflow file or homelab change needed.
- **Remove it entirely:** delete `argocd/applications/apps/ci-runner.yaml` and merge — Argo CD's
  `prune: true` removes everything under `apps/ci-runner/` including the namespace. Do this only
  after `CI_RUNNER_LABELS` is already unset, otherwise CI jobs queue forever waiting for a runner
  that no longer exists.

## Known gaps

- **Playwright OS dependencies.** The official `actions-runner` image has no `sudo`/root path
  for the non-root `runner` user, so `npx playwright install --with-deps` cannot run here.
  treelink PR #105 handles this by running `playwright install chromium` (browser binary only,
  no OS deps) on self-hosted. If Chromium's OS-level shared libraries are missing on this image,
  the E2E job will fail at browser launch, not at install. The real fix — a custom runner image
  with those packages baked in, built by treelink's own CI — is intentionally out of scope here;
  the owner decides when to prioritize it.
- **Persistent workspace.** Unlike GitHub-hosted (fresh VM every run), `_work` and `.cache`
  persist across jobs on this PVC. This is mostly a win (warm npm/Playwright caches) but means
  stale files from a previous job's checkout can leak into the next one if a workflow assumes a
  clean workspace. `actions/checkout` cleans its own target directory; anything a step writes
  outside of that is the workflow's problem, not this runner's.
- **buildx builder accumulation.** `docker/setup-buildx-action` creates a builder instance per
  run; on GitHub-hosted that disappears with the VM, but here it persists in the dind sidecar
  and accumulates over time. Nothing prunes it yet — `docker buildx prune` on a schedule, or
  reusing a named builder across runs, is a follow-up, not done in this PR.
- **No PodDisruptionBudget.** Deliberate — there is exactly one of these pods by design, so a
  PDB would only ever block legitimate node maintenance without protecting anything.
