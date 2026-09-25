# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Kubernetes homelab managed with **Argo CD** (GitOps, reconciling from `main`). Self-hosted
applications served at `gwynbliedd.com`.

> This repository used FluxCD until the Argo CD migration. Flux is fully removed — there
> are no `HelmRelease`, `HelmRepository` or `kustomize.toolkit.fluxcd.io/Kustomization`
> resources left in the cluster, and the `flux` CLI will not work. Stale Flux CRs still
> sit under `apps/docmost/` and `apps/old-apps/`; those apps are not deployed.

## Technology Stack

- **Kubernetes**: k3s (v1.34), 2 nodes (`gwynbliedd` control-plane, `node01`)
- **Argo CD**: GitOps continuous delivery (app-of-apps, auto-sync + prune + selfHeal)
- **Kustomize**: raw-manifest management
- **Helm**: charts pulled directly by Argo CD Applications
- **Traefik**: ingress controller (k3s built-in, `kube-system`)
- **CloudNative PG**: PostgreSQL operator
- **Cloudflare Tunnel**: external access (runs outside the cluster)
- **cert-manager**: TLS certificates (internal use)
- **Sealed Secrets**: encrypted secrets in git

## Key Commands

### Validate changes before committing
```bash
# Every path an Argo CD Application points at must build
kubectl kustomize apps/<app>/prod/<app>
kubectl kustomize infrastructure/<component>

# Preview what a Helm-backed app will render
helm template <release> <chart> --repo <chart-repo-url> --version <ver> \
  -n <namespace> -f apps/<app>/values.yaml
```

### Check Argo CD status
```bash
kubectl get applications -n argocd
kubectl describe application <name> -n argocd
argocd app list                     # if the CLI is set up
argocd app get <name>
argocd app diff <name>
```

### Force reconciliation
```bash
kubectl annotate application <name> -n argocd \
  argocd.argoproj.io/refresh=hard --overwrite
argocd app sync <name>
```

### Debug
```bash
kubectl logs -n argocd deploy/argocd-repo-server          # chart/kustomize render errors
kubectl logs -n argocd statefulset/argocd-application-controller
kubectl get pods -A
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
```

## Architecture

### Directory structure
- `/argocd/` — Argo CD control plane. See [argocd/README.md](./argocd/README.md).
  - `bootstrap/` — `AppProject` + root app-of-apps (applied by hand, once)
  - `applications/infrastructure/` — sync-wave `-2`
  - `applications/apps/` — sync-wave `0`
  - `parked/` — Applications intentionally not synced
- `/infrastructure/` — cert-manager, cnpg, sealed-secrets, metallb (parked)
- `/apps/` — one directory per application: `base/` (defaults) + `prod/` (overlay)
- `/notes/`, `/samples/`, `/test/`, `/drivers/` — reference material, not deployed

### Application pattern

A Helm-backed app is a **multi-source** Argo CD `Application`:

1. a `ref: values` source pointing at this repo, so `$values/...` resolves
2. a `path:` source pointing at the Kustomize overlay (`apps/<app>/prod/<app>`) that holds
   the Namespace, SealedSecrets, CNPG `Cluster` and Traefik `IngressRoute`
3. a `chart:` source with `valueFiles: [$values/apps/<app>/values.yaml]`

Apps with no chart (kavita, n8n, rustfs, wallabag) use a single `path:` source.

**Chart versions are pinned exactly** — Flux's semver ranges were replaced with the
version that was live at migration time so first sync adopts rather than upgrades.

## Adding a new application

### Helm-based
1. `mkdir -p apps/<app>/{base,prod}/<app>`
2. `base/namespace.yaml`, `base/kustomization.yaml`
3. `base/<app>/` for SealedSecrets / CNPG `Cluster` + its `kustomization.yaml`
4. `prod/<app>/ingressroute.yaml` (HTTP only, port 80 — Cloudflare terminates TLS)
5. `prod/<app>/kustomization.yaml` referencing `../../base` plus the overlay files
6. `apps/<app>/values.yaml` — the chart values
7. `argocd/applications/apps/<app>.yaml` — the multi-source `Application`
   (copy an existing one; set the chart repo URL, pin `targetRevision`, set `releaseName`)
8. Add the chart repo URL to `sourceRepos` in `argocd/bootstrap/project.yaml`
9. Cloudflare Tunnel: public hostname `<app>.gwynbliedd.com` → the Traefik service
10. Commit and push — the `root` Application picks the new file up automatically

### Manifest-based
Same, minus steps 6 and 8, and the `Application` gets a single `path:` source.

## Important notes

- **GitOps workflow**: all changes go through git; Argo CD syncs automatically
- **External access**: everything is fronted by Cloudflare Tunnel; no port forwarding
- **HTTPS**: Cloudflare "Always Use HTTPS" is on globally
- **IngressRoutes**: HTTP entrypoint (`web`) only — Cloudflare handles TLS
- **Secrets**: Sealed Secrets; see `infrastructure/sealed-secrets/README.md`
- **Domain**: all services are subdomains of `gwynbliedd.com`
- **Auth**: some services sit behind a Traefik `authentik-forwardauth` Middleware
- **MetalLB is not installed.** Traefik gets its external IP from k3s servicelb
  (`192.168.100.191`, `192.168.100.229`). `infrastructure/metallb` and `apps/traefik`
  are parked in `argocd/parked/` — enabling them would install MetalLB and claim
  `192.168.100.210`.

## Apps built from private source (Treelink)

Treelink's image lives in the Gitea container registry (`gitea.gwynbliedd.com/gwynbliedd/treelink`),
pulled with the sealed `gitea-registry` secret. Its repo (`github.com/GutsButcher/treelink`,
private) owns the release: `npm run release` builds, pushes and rewrites `newTag` in
`apps/treelink/prod/kustomization.yaml`. containerd could only fetch registry tokens after the
`gitea-forwarded-https` Middleware started sending `X-Forwarded-Proto: https` to Gitea (see
`apps/gitea/prod/gitea/ingressroute.yaml`). Email from apps goes to MailHog (`apps/mailhog`),
in-cluster only.

## Deployment dependencies

Sync waves give the ordering Flux got from `dependsOn`:

- wave `-2`: cert-manager, cnpg, sealed-secrets — must be Healthy before apps sync
- wave `0`: everything else

Apps that use `SealedSecret` or CNPG `Cluster` resources depend on wave `-2` having
installed the corresponding CRDs.

## Network architecture

- **Internal**: Traefik `LoadBalancer` in `kube-system`, IPs from k3s servicelb
- **External**: all traffic through Cloudflare Tunnel
- **No port forwarding**: the home router blocks direct inbound
- **TLS termination**: Cloudflare edge, not in-cluster

## Common issues and solutions

- **Redirect loops**: remove HTTP→HTTPS redirects in IngressRoutes; Cloudflare handles it
- **502 Bad Gateway**: the Cloudflare Tunnel service URL must be `http://`, not `https://`
- **App stuck `OutOfSync` with no diff**: usually a controller writing a field at runtime —
  add an `ignoreDifferences` entry rather than fighting it with `selfHeal`
- **`ComparisonError` / chart not found**: the upstream chart repo moved. Two already did
  (sealed-secrets, vaultwarden) — see [argocd/README.md](./argocd/README.md)
- **CRD apply fails with "too long"**: the Application needs `ServerSideApply=true`
- **`ComparisonError: ... field not declared` after a major chart bump**: Argo CD diffs
  against the CRD schema already in the cluster, so a chart whose CRs use newer fields
  deadlocks. Apply the chart's CRDs by hand with `kubectl apply --server-side` first —
  see [argocd/README.md](./argocd/README.md)
- **Self-hosted app works in a browser but not from a CLI/native client**: check the app's
  own configured public URL (e.g. vaultwarden's `DOMAIN`). Browsers use relative paths and
  paper over an `http://` value; API clients read it from `/api/config` and follow it.
