# Wallabag Helm Chart Migration Plan

This document outlines the plan to migrate Wallabag from manual Kubernetes manifests to a custom Helm chart.

## Current State

Wallabag is currently deployed using manual Kubernetes manifests in the `base/wallabag/` directory. This approach works but lacks the flexibility and maintainability of a Helm chart.

## Migration Workflow

### 1. Create Template Chart

```bash
# Create a new Helm chart
helm create wallabag-chart

# Clean up unnecessary template files
rm -rf wallabag-chart/templates/tests
rm wallabag-chart/templates/hpa.yaml
```

### 2. Adapt Template Chart for Wallabag

#### Key Changes Required:

**values.yaml**:
- Image configuration (wallabag/wallabag:latest)
- PostgreSQL connection settings
- Redis connection settings  
- Environment variables for Wallabag configuration
- Ingress settings for Traefik
- PVC for images storage
- Resource limits and requests

**templates/deployment.yaml**:
- Container ports (80)
- Environment variables from ConfigMap and Secrets
- Volume mounts for images
- Health checks

**templates/configmap.yaml**:
- SYMFONY__ENV__DOMAIN_NAME
- SYMFONY__ENV__FOSUSER_REGISTRATION
- SYMFONY__ENV__FOSUSER_CONFIRMATION
- Other Wallabag-specific settings

**templates/secret.yaml**:
- Database credentials
- Redis password
- Secret key
- Admin user credentials

**templates/service.yaml**:
- Service port configuration
- Selector labels

**templates/pvc.yaml**:
- Persistent volume for wallabag images
- Storage class and size

**templates/ingressroute.yaml**:
- Custom Traefik IngressRoute
- TLS configuration
- Middleware if needed

### 3. Create Helm Repository

```bash
# In the helm-charts repository
mkdir -p charts/wallabag
cp -r wallabag-chart/* charts/wallabag/

# Update Chart.yaml with proper metadata
# Package the chart
helm package charts/wallabag

# Update index
helm repo index . --url https://gutsbutcher.github.io/helm-charts/

# Commit and push
git add .
git commit -m "Add wallabag helm chart"
git push
```

### 4. Create Helm Release Configuration

**infrastructure/sources/personal-charts.yaml**:
```yaml
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: personal-charts
  namespace: flux-system
spec:
  interval: 30m
  url: https://gutsbutcher.github.io/helm-charts/
```

**apps/wallabag/base/wallabag/helmrelease.yaml**:
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: wallabag
  namespace: wallabag
spec:
  interval: 30m
  chart:
    spec:
      chart: wallabag
      version: "1.0.0"
      sourceRef:
        kind: HelmRepository
        name: personal-charts
        namespace: flux-system
  values:
    # Default values here
```

**apps/wallabag/prod/wallabag/helmrelease-patch.yaml**:
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: wallabag
  namespace: wallabag
spec:
  values:
    ingress:
      host: wallabag.gwynbliedd.com
    # Production-specific overrides
```

## Benefits of Migration

1. **Templating**: Reusable chart for different environments
2. **Version Control**: Semantic versioning of the application deployment
3. **Configuration Management**: Clear separation of configuration in values.yaml
4. **Rollback Capability**: Easy rollback to previous chart versions
5. **Consistency**: Follows the same pattern as other apps in the cluster

## Testing Strategy

1. Deploy to a test namespace first
2. Verify all environment variables are correctly set
3. Test database and Redis connectivity
4. Ensure data persistence works
5. Validate ingress routing
6. Test user registration and login

## Rollback Plan

Keep the current manual manifests as backup until the Helm deployment is verified stable for at least one week.