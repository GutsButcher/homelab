# Infrastructure Components

This directory contains the core infrastructure components required for the homelab cluster. These components are deployed before applications and provide essential services.

## Components

### cert-manager
Automated certificate management for Kubernetes, handling TLS certificates from Let's Encrypt and other certificate authorities.

### CloudNative PostgreSQL (CNPG)
A Kubernetes operator that manages PostgreSQL clusters, providing high availability, automated backups, and seamless scaling.

### MetalLB
A load balancer implementation for bare metal Kubernetes clusters, providing network load balancing for services.

### Sealed Secrets
Enables secure storage of secrets in Git by encrypting them with a public key. Only the cluster can decrypt these secrets.

### Sources
Helm repository definitions used by FluxCD to pull charts. Each source file defines a repository that can be referenced by HelmReleases.

## Deployment Order

Infrastructure components are deployed in a specific order to ensure dependencies are met:

1. **sources** - Helm repositories must be available first
2. **sealed-secrets** - Secret management should be available early
3. **cert-manager** - Certificate management for TLS
4. **metallb** - Load balancing for services
5. **cnpg** - Database operator for applications

## Adding New Infrastructure Components

1. Create a new directory under `/infrastructure/<component-name>/`
2. Add the component's Kubernetes manifests or HelmRelease
3. Update `/infrastructure/kustomization.yaml` to include the new component
4. Consider deployment order and dependencies

## Monitoring Infrastructure

```bash
# Check infrastructure components status
kubectl get pods -n cert-manager
kubectl get pods -n metallb-system
kubectl get pods -n sealed-secrets
kubectl get pods -n cnpg-system

# View HelmRelease status
flux get helmreleases -n infrastructure

# Check for issues
kubectl describe helmrelease <name> -n infrastructure
```