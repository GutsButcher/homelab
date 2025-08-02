# CloudNative PostgreSQL (CNPG)

CloudNative PostgreSQL is a Kubernetes operator that manages PostgreSQL clusters with native High Availability, automated backups, and seamless scaling.

## Overview

CNPG provides production-ready PostgreSQL on Kubernetes with:
- Automated failover and high availability
- Point-in-time recovery
- Rolling updates with zero downtime
- Native Kubernetes integration
- Declarative configuration

## Components

- **HelmRelease**: Deploys the CNPG operator
- **Default Values**: Configuration for the operator
- **Kustomization**: Combines resources for deployment

## Usage

Applications can request PostgreSQL clusters by creating a `Cluster` resource:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: app-postgres
  namespace: app-namespace
spec:
  instances: 3
  postgresql:
    parameters:
      max_connections: "100"
  bootstrap:
    initdb:
      database: appdb
      owner: appuser
      secret:
        name: app-postgres-credentials
  storage:
    size: 10Gi
```

## Features in Use

- **High Availability**: 3-instance clusters for critical applications
- **Automated Backups**: Configured per cluster based on requirements
- **Connection Pooling**: PgBouncer integration where needed
- **Monitoring**: Prometheus metrics exported automatically

## Applications Using CNPG

- n8n - Workflow automation database
- Potentially other applications requiring PostgreSQL

## Best Practices

1. Always use at least 3 instances for production workloads
2. Configure appropriate resource limits
3. Set up regular backups with retention policies
4. Monitor disk usage and plan for growth
5. Use connection pooling for high-traffic applications

## Troubleshooting

```bash
# Check operator status
kubectl get pods -n cnpg-system

# View PostgreSQL clusters
kubectl get clusters -A

# Check cluster status
kubectl describe cluster <name> -n <namespace>

# View operator logs
kubectl logs -n cnpg-system deployment/cnpg-controller-manager
```