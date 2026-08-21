# N8N Helm Chart Migration Plan

This document outlines the plan to migrate n8n from manual Kubernetes manifests to a custom Helm chart.

## Current State

N8N is currently deployed using manual Kubernetes manifests with:
- Deployment configuration with environment variables
- Service exposure
- Traefik IngressRoute
- PostgreSQL database via CloudNative PG
- Sealed secrets for database and SMTP configuration

## Migration Workflow

### 1. Create Template Chart

```bash
# Create a new Helm chart
helm create n8n-chart

# Clean up unnecessary template files
rm -rf n8n-chart/templates/tests
rm n8n-chart/templates/hpa.yaml
rm n8n-chart/templates/serviceaccount.yaml
```

### 2. Adapt Template Chart for N8N

#### Key Changes Required:

**values.yaml**:
```yaml
image:
  repository: n8nio/n8n
  tag: latest
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 5678

ingress:
  enabled: true
  className: traefik
  host: n8n.gwynbliedd.com
  tls:
    enabled: true

persistence:
  enabled: true
  storageClass: ""
  size: 10Gi
  mountPath: /home/node/.n8n

postgresql:
  enabled: true
  existingSecret: n8n-postgres-credentials
  database: n8n

smtp:
  enabled: false
  existingSecret: n8n-smtp-secret

env:
  N8N_BASIC_AUTH_ACTIVE: "false"
  N8N_HOST: n8n.gwynbliedd.com
  N8N_PORT: "5678"
  N8N_PROTOCOL: https
  WEBHOOK_URL: https://n8n.gwynbliedd.com
  N8N_EDITOR_BASE_URL: https://n8n.gwynbliedd.com
  GENERIC_TIMEZONE: Europe/London

resources:
  limits:
    memory: 1Gi
  requests:
    memory: 512Mi
    cpu: 100m
```

**templates/deployment.yaml**:
- Container configuration with n8n image
- Environment variables from values and secrets
- Volume mounts for data persistence
- Liveness and readiness probes
- Security context for node user

**templates/configmap.yaml**:
- Non-sensitive environment variables
- N8N configuration options

**templates/secret.yaml**:
- Template for creating secrets if not using existing ones
- Support for both database and SMTP credentials

**templates/pvc.yaml**:
- Persistent volume claim for n8n data
- Workflow storage and user data

**templates/ingressroute.yaml**:
- Traefik-specific IngressRoute
- TLS configuration with cert-manager
- Proper headers and middleware

**templates/cnpg-cluster.yaml** (optional):
- CloudNative PG cluster definition
- Can be toggled with values

### 3. Create Helm Repository

```bash
# In the helm-charts repository
mkdir -p charts/n8n
cp -r n8n-chart/* charts/n8n/

# Update Chart.yaml
cat > charts/n8n/Chart.yaml <<EOF
apiVersion: v2
name: n8n
description: A Helm chart for n8n workflow automation
type: application
version: 1.0.0
appVersion: "latest"
keywords:
  - n8n
  - workflow
  - automation
  - nocode
home: https://n8n.io
sources:
  - https://github.com/n8n-io/n8n
maintainers:
  - name: gutsbutcher
EOF

# Package and index
helm package charts/n8n
helm repo index . --url https://gutsbutcher.github.io/helm-charts/

# Commit and push
git add .
git commit -m "Add n8n helm chart"
git push
```

### 4. Create Helm Release Configuration

**apps/n8n/base/n8n/helmrelease.yaml**:
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: n8n
  namespace: n8n
spec:
  interval: 30m
  chart:
    spec:
      chart: n8n
      version: ">=1.0.0"
      sourceRef:
        kind: HelmRepository
        name: personal-charts
        namespace: flux-system
  values:
    # Default values
    persistence:
      enabled: true
      size: 10Gi
```

**apps/n8n/prod/n8n/helmrelease-patch.yaml**:
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: n8n
  namespace: n8n
spec:
  values:
    ingress:
      host: n8n.gwynbliedd.com
    postgresql:
      existingSecret: n8n-postgres-credentials
    resources:
      limits:
        memory: 2Gi
      requests:
        memory: 1Gi
```

## Special Considerations

1. **Database Migration**: Ensure existing PostgreSQL data is preserved
2. **Workflow Persistence**: Verify /home/node/.n8n volume migration
3. **Webhook URLs**: Test all webhook-based workflows after migration
4. **Environment Variables**: Validate all n8n-specific env vars are set correctly
5. **SMTP Configuration**: If email is configured, test notifications

## Benefits of Migration

1. **Standardization**: Follows the same Helm pattern as other apps
2. **Configurability**: Easy environment-specific overrides
3. **Upgrades**: Simplified n8n version updates
4. **Backup**: Clear data persistence boundaries
5. **Scaling**: Easier to scale if needed in future

## Testing Strategy

1. Create test namespace `n8n-test`
2. Deploy Helm chart with test database
3. Import sample workflows
4. Test webhook functionality
5. Verify data persistence across pod restarts
6. Test email notifications if configured
7. Performance testing with complex workflows

## Data Migration Steps

1. Backup current n8n data and workflows
2. Export PostgreSQL database
3. Deploy new Helm-based n8n in parallel
4. Import database backup
5. Verify all workflows are intact
6. Switch traffic to new deployment
7. Monitor for 24 hours before removing old deployment