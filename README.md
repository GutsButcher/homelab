# Homelab GitOps Repository

This repository contains the complete infrastructure and application configurations for my personal Kubernetes homelab, managed through GitOps with FluxCD.

## Overview

A self-hosted Kubernetes cluster running various applications at gwynbliedd.com, using GitOps principles for continuous deployment and infrastructure management.

## Technology Stack

- **Kubernetes**: Container orchestration platform
- **FluxCD**: GitOps continuous delivery solution
- **Kustomize**: Kubernetes native configuration management
- **Helm**: Kubernetes package manager
- **Traefik**: Modern reverse proxy and ingress controller
- **CloudNative PG**: PostgreSQL operator for Kubernetes
- **Sealed Secrets**: Encrypted secrets management
- **MetalLB**: Bare metal load balancer
- **cert-manager**: Automatic TLS certificate management

## Repository Structure

```
.
├── clusters/
│   └── homelab/         # FluxCD cluster configuration
├── infrastructure/       # Core infrastructure components
│   ├── sources/         # Helm repository definitions
│   └── [components]/    # Infrastructure applications
├── apps/                # Application deployments
│   └── [app-name]/      # Individual application configurations
│       ├── base/        # Base configurations
│       └── prod/        # Production overlays
└── scripts/             # Utility scripts
```

### Documentation

- [Clusters Configuration](./clusters/README.md) - FluxCD setup and bootstrapping
- [Infrastructure Components](./infrastructure/README.md) - Core services documentation
- [Applications](./apps/README.md) - Deployed applications overview
- [Scripts](./scripts/README.md) - Utility scripts and automation tools

## Deployed Applications

### Infrastructure Components
- **[cert-manager](./infrastructure/cert-manager/README.md)**: Automated TLS certificate management
- **[CloudNative PG](./infrastructure/cnpg/README.md)**: PostgreSQL database operator
- **[MetalLB](./infrastructure/metallb/README.md)**: Load balancer for bare metal Kubernetes
- **[Sealed Secrets](./infrastructure/sealed-secrets/README.md)**: Secure secret management
- **[Traefik](./apps/traefik/README.md)**: Ingress controller and reverse proxy

### Applications

#### Media & Entertainment
- **[Jellyfin](./apps/jellyfin/README.md)**: Media server for movies, TV shows, and music
- **[Jellyseerr](./apps/jellyseerr/README.md)**: Media request management for Jellyfin
- **[Prowlarr](./apps/prowlarr/README.md)**: Indexer manager for media automation
- **[Radarr](./apps/radarr/README.md)**: Movie collection manager
- **[Sonarr](./apps/sonarr/README.md)**: TV series collection manager
- **[qBittorrent](./apps/qbittorrent/README.md)**: BitTorrent client

#### Productivity & Tools
- **[Homepage](./apps/homepage/README.md)**: Personal dashboard and service catalog
- **[IT-Tools](./apps/it-tools/README.md)**: Collection of handy IT utilities
- **[n8n](./apps/n8n/README.md)**: Workflow automation platform ([Migration Plan](./apps/n8n/CLAUDE.md))
- **[Obsidian LiveSync](./apps/obsidian/README.md)**: Self-hosted Obsidian synchronization
- **[Wallabag](./apps/wallabag/README.md)**: Read-it-later application ([Migration Plan](./apps/wallabag/CLAUDE.md))

#### Monitoring & Management
- **[Dozzle](./apps/dozzle/README.md)**: Real-time Docker log viewer
- **[Glances](./apps/glances/README.md)**: System monitoring dashboard
- **[Monitoring Stack](./apps/monitoring/README.md)**: Prometheus-based monitoring

#### Development & Gaming
- **[Gwent Game](./apps/gwent-game/README.md)**: Web-based card game
- **[Jenkins](./apps/jenkins/README.md)**: CI/CD automation server
- **[Linkding](./apps/linkding/README.md)**: Bookmark manager
- **[PgAdmin](./apps/pgadmin/README.md)**: PostgreSQL management tool
- **[VS Code Server](./apps/vscode/README.md)**: Web-based code editor (not deployed)

## Getting Started

### Prerequisites
- Kubernetes cluster (1.28+)
- FluxCD CLI installed
- kubectl configured with cluster access

### Cluster Bootstrap

1. Fork this repository
2. Update cluster configuration in `clusters/homelab/`
3. Bootstrap FluxCD:
   ```bash
   flux bootstrap github \
     --owner=<your-username> \
     --repository=<your-repo> \
     --branch=main \
     --path=./clusters/homelab
   ```

### Verifying Deployment

```bash
# Check FluxCD components
flux check

# View all FluxCD resources
flux get all

# Monitor reconciliation
flux logs --follow

# Check application status
kubectl get helmreleases -A
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
2. FluxCD automatically syncs from the main branch every minute
3. Kustomize patches are applied for environment-specific configurations
4. Helm releases are managed declaratively through HelmRelease resources

## Contributing

While this is a personal homelab repository, suggestions and improvements are welcome through issues and pull requests.

## License

This project is open source and available under the [MIT License](LICENSE).

## Additional Resources

### Internal Documentation
- [CLAUDE.md](./CLAUDE.md) - AI assistant guidelines and codebase overview
- [Script Ideas](./scripts/CLAUDE.md) - Future automation plans
- [Infrastructure Sources](./infrastructure/sources/) - Helm repository configurations

### External Links
- [FluxCD Documentation](https://fluxcd.io/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Helm Documentation](https://helm.sh/docs/)
- [Kustomize Documentation](https://kustomize.io/)

## Acknowledgments

Built with excellent open-source tools and inspired by the Kubernetes and GitOps communities.
