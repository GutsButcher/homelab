# Homelab GitOps Repository

This repository contains the complete infrastructure and application configurations for my personal Kubernetes homelab, managed through GitOps with Argo CD.

## Overview

A self-hosted k3s cluster running various applications at gwynbliedd.com, using GitOps
principles for continuous deployment and infrastructure management.

> **Migrated off FluxCD.** Flux is no longer installed; Argo CD reconciles everything
> from `main`. See [argocd/README.md](./argocd/README.md) for how the pieces fit together.

## Technology Stack

- **Kubernetes**: Container orchestration platform
- **Argo CD**: GitOps continuous delivery solution
- **Kustomize**: Kubernetes native configuration management
- **Helm**: Kubernetes package manager
- **Traefik**: Modern reverse proxy and ingress controller
- **CloudNative PG**: PostgreSQL operator for Kubernetes
- **Sealed Secrets**: Encrypted secrets management
- **MetalLB**: Bare metal load balancer *(declared but currently not installed — see `argocd/parked/`)*
- **cert-manager**: Automatic TLS certificate management

## Repository Structure

```
.
├── argocd/
│   ├── bootstrap/       # AppProject + root app-of-apps (applied once, by hand)
│   ├── applications/    # One Argo CD Application per deployed component
│   └── parked/          # Applications deliberately not synced
├── infrastructure/      # Core infrastructure components
│   └── [component]/     # Namespace, values.yaml, extra manifests
├── apps/                # Application deployments
│   └── [app-name]/
│       ├── values.yaml  # Helm values (was HelmRelease spec.values under Flux)
│       ├── base/        # Base configurations
│       └── prod/        # Production overlays
└── scripts/             # Utility scripts
```

### Documentation

- [Argo CD Configuration](./argocd/README.md) - GitOps setup and bootstrapping
- [Infrastructure Components](./infrastructure/README.md) - Core services documentation
- [Applications](./apps/README.md) - Deployed applications overview
- [Scripts](./scripts/README.md) - Utility scripts and automation tools

## Deployed Applications

### Infrastructure (Argo CD sync-wave -2)
- **[cert-manager](./infrastructure/cert-manager/README.md)** — TLS certificate management
- **[CloudNative PG](./infrastructure/cnpg/README.md)** — PostgreSQL operator
- **[Sealed Secrets](./infrastructure/sealed-secrets/README.md)** — encrypted secrets in git

### Applications (sync-wave 0)
| App | URL | Source |
| --- | --- | --- |
| Authentik | `auth.gwynbliedd.com` | Helm `authentik` |
| Gitea | `gitea.gwynbliedd.com` | Helm `gitea` |
| Homepage | `home.gwynbliedd.com` | Helm `homepage` |
| Kavita | `books.gwynbliedd.com` | manifests |
| Linkding | `linkding.gwynbliedd.com` | Helm `linkding` |
| MailHog (SMTP test sink) | `mailhog.gwynbliedd.com` | manifests |
| Monitoring (Prometheus + Grafana) | `grafana.gwynbliedd.com` | Helm `kube-prometheus-stack` |
| n8n | `n8n.gwynbliedd.com` | manifests |
| Treelink (link-in-bio) | `treelink.gwynbliedd.com` | manifests, image from Gitea registry |
| pgAdmin | `pgadmin.gwynbliedd.com` | Helm `pgadmin4` |
| RustFS (S3) | `s3.gwynbliedd.com`, `s3-api.gwynbliedd.com` | manifests |
| Vaultwarden | `vaultwarden.gwynbliedd.com` | Helm `vaultwarden` |
| Wallabag | `wallabag.gwynbliedd.com` | manifests |

### Not deployed
- **MetalLB**, **traefik-metallb Service**, **IT-Tools**, **Syncthing** — parked, see
  [argocd/parked/README.md](./argocd/parked/README.md)
- **Docmost**, **`apps/old-apps/*`** (Jenkins, Pi-hole, Nextcloud, Gwent) — manifests kept
  for reference only; they still contain Flux CRs that nothing can act on

## Getting Started

### Prerequisites
- Kubernetes cluster (1.28+)
- Argo CD installed in the `argocd` namespace
- kubectl configured with cluster access

### Cluster Bootstrap

Argo CD is installed manually and is not self-managed. Once it is running, hand it the
cluster with two applies:

```bash
kubectl apply -f argocd/bootstrap/project.yaml
kubectl apply -f argocd/bootstrap/root.yaml
```

The `root` Application recursively watches `argocd/applications/`, so every component
below is created from there. This repository is public, so no Argo CD repository
credentials are needed.

### Verifying Deployment

```bash
# Application status
kubectl get applications -n argocd

# Why is something OutOfSync / Degraded
kubectl describe application <name> -n argocd
kubectl logs -n argocd deploy/argocd-repo-server     # render errors

# Workload status
kubectl get pods -A
```

## Secret Management

This repository uses [Sealed Secrets](./infrastructure/sealed-secrets/README.md) for secure secret storage. Sealed secrets are encrypted and safe to store in Git.

### Creating a Sealed Secret

```bash
# Create a regular secret
kubectl create secret generic my-secret \
  --from-literal=username=admin \
  --from-literal=password=secretpassword \
  --dry-run=client -o yaml > secret.yaml

# Seal the secret
kubeseal --format=yaml < secret.yaml > sealed-secret.yaml

# Apply the sealed secret
kubectl apply -f sealed-secret.yaml
```

For detailed instructions and examples, see the [Sealed Secrets documentation](./infrastructure/sealed-secrets/README.md).

## GitOps Workflow

1. All changes are made through Git commits
2. Argo CD automatically syncs from the `main` branch (`prune` + `selfHeal` enabled)
3. Kustomize overlays cover Namespaces, SealedSecrets, CNPG clusters and Traefik routes
4. Helm charts are pulled directly by multi-source Argo CD `Application` resources, with
   values read from `apps/<app>/values.yaml`
5. Chart versions are pinned exactly — bump `targetRevision` to upgrade

## Contributing

While this is a personal homelab repository, suggestions and improvements are welcome through issues and pull requests.

## License

This project is open source and available under the [MIT License](LICENSE).

## Additional Resources

### Internal Documentation
- [CLAUDE.md](./CLAUDE.md) - AI assistant guidelines and codebase overview
- [Argo CD setup](./argocd/README.md) - Control plane layout and migration notes
- [Script Ideas](./scripts/CLAUDE.md) - Future automation plans

### External Links
- [Argo CD Documentation](https://argo-cd.readthedocs.io/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [Kustomize Documentation](https://kustomize.io/)

## Acknowledgments

Built with excellent open-source tools and inspired by the Kubernetes and GitOps communities.
