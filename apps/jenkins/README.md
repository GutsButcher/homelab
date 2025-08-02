# Jenkins

Jenkins is an open-source automation server that enables continuous integration and continuous delivery (CI/CD) pipelines.

## Overview

This Jenkins instance provides:
- Automated build and deployment pipelines
- Integration with Git repositories
- Plugin ecosystem for extended functionality
- Distributed build capabilities

## Access

- **URL**: https://jenkins.gwynbliedd.com
- **Authentication**: Admin credentials stored in sealed secret
- **Initial Setup**: Configuration as Code (JCasC)

## Configuration

Jenkins is deployed using Helm with:
- Persistent volume for Jenkins home
- Configuration as Code for reproducible setup
- Sealed secrets for admin credentials
- Resource limits for stability

## Key Features

### Security
- Admin credentials in sealed secrets
- RBAC configuration
- HTTPS only access via Traefik

### Persistence
- Jenkins home directory on PVC
- Job configurations preserved
- Plugin data maintained

### Integration
- Git webhook support
- Kubernetes plugin for dynamic agents
- Docker-in-Docker capability

## Sealed Secrets

The Jenkins admin credentials are stored as a sealed secret:
- Secret name: `jenkins-admin-secret`
- Fields: `jenkins-admin-user`, `jenkins-admin-password`

## Common Tasks

### Access Admin Password
```bash
# The password is stored in a sealed secret
# Only the sealed-secrets controller can decrypt it
kubectl get secret jenkins-admin-secret -n jenkins -o jsonpath='{.data.jenkins-admin-password}' | base64 -d
```

### Backup Jenkins
1. Stop Jenkins safely
2. Backup the PVC containing Jenkins home
3. Export job configurations
4. Document installed plugins

### Update Plugins
1. Access Jenkins UI
2. Navigate to Manage Jenkins > Plugin Manager
3. Select updates and apply
4. Restart Jenkins if required

## Troubleshooting

```bash
# Check Jenkins pod
kubectl get pods -n jenkins

# View Jenkins logs
kubectl logs -n jenkins -l app.kubernetes.io/name=jenkins

# Restart Jenkins
kubectl rollout restart deployment jenkins -n jenkins

# Check PVC status
kubectl get pvc -n jenkins
```

## Best Practices

1. Regular backups of Jenkins home
2. Keep plugins updated
3. Use JCasC for configuration
4. Implement proper RBAC
5. Monitor resource usage