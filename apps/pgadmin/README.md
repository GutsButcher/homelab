# PgAdmin

PgAdmin is a comprehensive PostgreSQL management tool providing a web-based interface for database administration.

## Overview

PgAdmin enables:
- PostgreSQL database management
- Query execution and analysis
- Database design and modeling
- User and permission management
- Performance monitoring

## Access

- **URL**: https://pgadmin.gwynbliedd.com
- **Authentication**: Email/password stored in sealed secret
- **Default Email**: Configured during deployment

## Configuration

PgAdmin is deployed using Helm with:
- Sealed secret for admin credentials
- Persistent volume for configuration
- Server definitions pre-configured
- TLS via Traefik ingress

## Features

### Database Connections
Pre-configured connections to:
- CNPG PostgreSQL clusters
- Application databases (n8n, wallabag)

### Security
- Credentials stored in sealed secrets
- HTTPS-only access
- Session management

### Persistence
- Server configurations saved
- Query history maintained
- User preferences preserved

## Sealed Secret

Admin credentials stored in `pgadmin-credentials`:
- Field: `password`
- Used with configured email address

## Common Tasks

### Add Database Server
1. Login to PgAdmin
2. Right-click Servers > Create > Server
3. Enter connection details:
   - Host: `<service>.<namespace>.svc.cluster.local`
   - Port: 5432
   - Username/Password from secret

### Backup Database
1. Right-click database
2. Select Backup
3. Choose format and options
4. Download backup file

### Execute Queries
1. Select database
2. Open Query Tool
3. Write and execute SQL
4. Export results as needed

## Integration with CNPG

PgAdmin can connect to CNPG clusters using:
- Service DNS names
- Credentials from cluster secrets
- Connection pooling if configured

## Troubleshooting

```bash
# Check PgAdmin pod
kubectl get pods -n pgadmin

# View logs
kubectl logs -n pgadmin -l app.kubernetes.io/name=pgadmin

# Check secret
kubectl get sealedsecret pgadmin-credentials -n pgadmin

# Restart PgAdmin
kubectl rollout restart deployment pgadmin -n pgadmin
```

## Best Practices

1. Use read-only credentials when possible
2. Avoid storing sensitive data in queries
3. Regular cleanup of old sessions
4. Monitor disk usage for logs
5. Keep PgAdmin updated