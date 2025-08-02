# Clusters Configuration

This directory contains the FluxCD cluster configurations that serve as the entry point for GitOps deployment.

## Structure

```
clusters/
└── homelab/
    ├── apps.yaml          # Kustomization for application deployments
    ├── flux-system/       # FluxCD core components (auto-generated)
    └── infrastructure.yaml # Kustomization for infrastructure components
```

## How It Works

1. **FluxCD Bootstrap**: When FluxCD is bootstrapped, it creates the `flux-system` directory with core components
2. **Infrastructure First**: The `infrastructure.yaml` Kustomization deploys core infrastructure components
3. **Applications Second**: The `apps.yaml` Kustomization deploys applications after infrastructure is ready

## Key Files

### infrastructure.yaml
- Points to `/infrastructure` directory
- Deploys in order: sources → infrastructure components
- Creates namespaces and core services needed by applications

### apps.yaml
- Points to `/apps` directory  
- Depends on infrastructure being deployed first
- Deploys all application workloads

## Bootstrapping a New Cluster

```bash
flux bootstrap github \
  --owner=<github-username> \
  --repository=<repository-name> \
  --branch=main \
  --path=./clusters/homelab \
  --personal
```

## Monitoring Sync Status

```bash
# Check if FluxCD is healthy
flux check

# View sync status
flux get kustomizations

# Watch for changes
flux logs --follow
```

## Troubleshooting

If applications fail to deploy:
1. Check infrastructure is healthy: `flux get ks infrastructure`
2. Check for dependency issues: `kubectl describe kustomization apps -n flux-system`
3. View reconciliation errors: `flux events`