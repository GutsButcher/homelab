# n8n

n8n is a workflow automation tool that allows you to connect various services and create automated workflows with a visual node-based editor.

## Overview

n8n provides:
- Visual workflow builder with 300+ integrations
- Self-hosted solution with full data control
- Code-free automation for non-developers
- JavaScript code support for complex logic
- Webhook triggers for real-time automation
- Scheduled workflow execution
- Error handling and retry logic

## Access

- **URL**: https://n8n.gwynbliedd.com
- **Authentication**: User accounts created on first access
- **Admin Panel**: Available after login

## Current Deployment

n8n is deployed using manual Kubernetes manifests with:
- PostgreSQL database via CNPG
- Persistent volume for workflow data
- Environment variables for configuration
- Sealed secrets for sensitive data

**Note**: See `CLAUDE.md` for the planned migration to Helm chart.

## Features

### Workflow Building
- **300+ Nodes**: Connect to popular services
- **Custom Functions**: Write JavaScript for complex logic
- **Error Workflows**: Handle failures gracefully
- **Sub-workflows**: Modular workflow design
- **Variables**: Store and reuse data
- **Versioning**: Track workflow changes

### Triggers
- **Webhooks**: Real-time event processing
- **Cron**: Scheduled execution
- **Email**: Trigger on email receipt
- **RSS**: Monitor feeds
- **Database**: React to data changes

### Security
- Self-hosted with complete data control
- Encrypted credential storage
- User access management
- Webhook authentication
- SSL/TLS encryption

## Configuration

Key environment variables:
- `N8N_HOST`: Set to n8n.gwynbliedd.com
- `N8N_PROTOCOL`: https
- `WEBHOOK_URL`: Public webhook endpoint
- `DB_TYPE`: postgresdb
- `GENERIC_TIMEZONE`: Your timezone

## Common Workflows

### Examples
1. **Social Media Automation**: Cross-post content
2. **Data Sync**: Keep systems synchronized
3. **Monitoring**: Alert on system events
4. **Backup Automation**: Regular data exports
5. **Report Generation**: Scheduled reports

## Database

n8n uses PostgreSQL for:
- Workflow definitions
- Execution history
- User credentials
- Webhook registrations

## Common Tasks

### Export Workflows
```bash
# Export all workflows
kubectl exec -n n8n deployment/n8n -- n8n export:workflow --all
```

### Import Workflows
```bash
# Import workflows from file
kubectl exec -n n8n deployment/n8n -- n8n import:workflow --input=workflows.json
```

### Clear Execution Data
```bash
# Remove old execution data
kubectl exec -n n8n deployment/n8n -- n8n executiondata:prune --days 30
```

### List Workflows
```bash
# Show all workflows
kubectl exec -n n8n deployment/n8n -- n8n list:workflow
```

## Troubleshooting

```bash
# Check n8n pod
kubectl get pods -n n8n

# View logs
kubectl logs -n n8n -l app=n8n

# Check database connection
kubectl exec -n n8n deployment/n8n -- n8n doctor

# Restart n8n
kubectl rollout restart deployment n8n -n n8n

# Check webhook accessibility
curl https://n8n.gwynbliedd.com/webhook-test/
```

## Maintenance

### Database Optimization
```bash
# Optimize database performance
kubectl exec -n n8n deployment/n8n -- n8n db:optimize
```

### Backup Workflows
1. Export all workflows regularly
2. Backup PostgreSQL database
3. Save credential backups securely

### Update n8n
1. Check changelog for breaking changes
2. Backup workflows and database
3. Update container image
4. Run database migrations if needed

## Best Practices

1. **Test First**: Use test data before production
2. **Error Handling**: Add error workflows
3. **Documentation**: Document complex workflows
4. **Credentials**: Use n8n's credential system
5. **Monitoring**: Set up alerts for failures
6. **Versioning**: Track workflow changes
7. **Resource Limits**: Monitor memory usage

## Integration Tips

- Use environment variables for configuration
- Implement webhook authentication
- Set up error notification workflows
- Use sub-workflows for reusability
- Regular execution data cleanup