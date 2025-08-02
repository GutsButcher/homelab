# Linkding

Linkding is a self-hosted bookmark manager that helps you organize and archive your bookmarks with tags, descriptions, and full-text search.

## Overview

Linkding provides:
- Clean, minimal interface for bookmark management
- Full-text search across bookmarks
- Tag-based organization
- Bookmark archiving
- Import/export functionality
- Browser extension support
- REST API for integrations

## Access

- **URL**: https://linkding.gwynbliedd.com
- **Authentication**: User accounts managed within application
- **Admin Access**: Superuser created during initial setup

## Features

### Core Functionality
- **Quick Add**: Bookmarklet for easy bookmark addition
- **Tags**: Hierarchical tag system with auto-completion
- **Search**: Full-text search including archived content
- **Archive**: Automatic archiving of bookmark content
- **Notes**: Add personal notes to bookmarks

### Integration
- Browser extensions for Chrome/Firefox
- REST API for automation
- Import from other bookmark services
- Export in standard formats

### Privacy
- Self-hosted solution
- No external dependencies
- Optional archive functionality
- Complete data ownership

## Configuration

Deployed using Helm with:
- PostgreSQL database for data storage
- Persistent volume for archived content
- Environment variables for customization
- Traefik ingress with TLS

## Database

Linkding uses PostgreSQL for:
- Bookmark metadata
- User accounts
- Tags and categories
- Search index

## Common Tasks

### Backup Bookmarks
1. Navigate to Settings > Export
2. Choose export format (HTML/JSON)
3. Download backup file

### Import Bookmarks
1. Go to Settings > Import
2. Upload bookmark file
3. Review import settings
4. Process import

### API Usage
```bash
# Get API token from settings
TOKEN="your-api-token"

# Add bookmark via API
curl -X POST https://linkding.gwynbliedd.com/api/bookmarks/ \
  -H "Authorization: Token $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "title": "Example", "tags": ["sample"]}'
```

## Troubleshooting

```bash
# Check Linkding pod
kubectl get pods -n linkding

# View logs
kubectl logs -n linkding -l app.kubernetes.io/name=linkding

# Check database connection
kubectl exec -n linkding deployment/linkding -- python manage.py dbshell

# Restart Linkding
kubectl rollout restart deployment linkding -n linkding
```

## Maintenance

### Database Cleanup
```bash
# Remove old archived content
kubectl exec -n linkding deployment/linkding -- python manage.py cleanup_archived_content
```

### Update Search Index
```bash
# Rebuild search index if needed
kubectl exec -n linkding deployment/linkding -- python manage.py rebuild_index
```

## Best Practices

1. Regular bookmark exports for backup
2. Organize with consistent tag naming
3. Archive important bookmarks
4. Use API for bulk operations
5. Monitor disk usage for archives