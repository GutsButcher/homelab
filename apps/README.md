# Applications

This directory contains all application deployments for the homelab. Each application follows a consistent structure using Kustomize for configuration management.

## Directory Structure

Each application follows this pattern:
```
<app-name>/
├── base/                    # Base configuration
│   ├── namespace.yaml       # Namespace definition
│   └── <app-name>/         # Application resources
│       ├── helmrelease.yaml # Helm release definition (if using Helm)
│       ├── default_values.yaml # Default Helm values
│       └── kustomization.yaml  # Kustomize configuration
└── prod/                    # Production overlays
    └── <app-name>/
        ├── helmrelease-patch.yaml # Production-specific patches
        ├── ingressroute.yaml     # Traefik ingress configuration
        └── kustomization.yaml    # Kustomize configuration
```

## Deployed Applications

### Media & Entertainment
- **Jellyfin**: Self-hosted media server
- **Jellyseerr**: Media request management
- **Prowlarr**: Indexer manager
- **Radarr**: Movie collection automation
- **Sonarr**: TV series collection automation
- **qBittorrent**: BitTorrent client

### Productivity & Tools
- **Homepage**: Personal dashboard
- **IT-Tools**: Collection of useful tools
- **n8n**: Workflow automation
- **Obsidian LiveSync**: Note synchronization
- **Wallabag**: Read-it-later application

### Monitoring & Management
- **Dozzle**: Container log viewer
- **Glances**: System monitoring

## Adding a New Application

### For Helm-based Applications:

1. Ensure the Helm repository is defined in `/infrastructure/sources/`
2. Create the application structure:
   ```bash
   mkdir -p apps/<app-name>/{base,prod}/<app-name>
   ```
3. Create base configuration files
4. Create production overlays with environment-specific values
5. Update `/apps/kustomization.yaml` to include the new application

### For Manifest-based Applications:

Follow the same structure but use raw Kubernetes manifests instead of HelmRelease resources.

## Common Patterns

### Ingress Configuration
All applications use Traefik IngressRoutes with the pattern:
- Host: `<app-name>.gwynbliedd.com`
- TLS enabled with cert-manager
- Optional authentication middleware

### Database Connections
Applications requiring PostgreSQL use CloudNative PG with connection details stored in sealed secrets.

### Persistent Storage
Applications use PersistentVolumeClaims with appropriate storage classes based on data requirements.

## Troubleshooting

```bash
# Check application pods
kubectl get pods -n <app-name>

# View application logs
kubectl logs -n <app-name> <pod-name>

# Check HelmRelease status
flux get helmrelease <app-name> -n <app-name>

# Force reconciliation
flux reconcile helmrelease <app-name> -n <app-name>
```