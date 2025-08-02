# Wallabag

Wallabag is a self-hosted read-it-later application that allows you to save web articles and read them later on any device.

## Overview

Wallabag provides:
- Save articles from anywhere via browser extensions, mobile apps, or bookmarklets
- Clean, distraction-free reading experience
- Offline reading support
- Article tagging and organization
- Full-text search
- Multiple format exports (PDF, EPUB, MOBI)
- RSS feeds for saved articles

## Access

- **URL**: https://wallabag.gwynbliedd.com
- **Authentication**: User accounts with registration enabled
- **Admin Panel**: Available for admin users

## Current Deployment

Wallabag is currently deployed using manual Kubernetes manifests with:
- PostgreSQL database for article storage
- Redis for caching and async jobs
- Persistent volume for images
- Multiple containers for web and async workers

**Note**: See `CLAUDE.md` for the planned migration to Helm chart.

## Features

### Content Management
- **Import**: From Pocket, Instapaper, Firefox, Chrome
- **Export**: PDF, EPUB, MOBI, CSV, JSON, XML
- **Tagging**: Organize articles with tags
- **Filtering**: By reading status, tags, reading time
- **Annotations**: Highlight and annotate articles

### Integration
- Browser extensions (Chrome, Firefox, Opera)
- Mobile apps (iOS, Android)
- API for third-party apps
- RSS feeds for all article lists
- Share articles publicly

### Configuration

Key environment variables:
- `SYMFONY__ENV__DOMAIN_NAME`: Set to wallabag.gwynbliedd.com
- `SYMFONY__ENV__FOSUSER_REGISTRATION`: Enabled
- `SYMFONY__ENV__DATABASE_*`: PostgreSQL connection
- `SYMFONY__ENV__REDIS_*`: Redis connection

## Architecture

Wallabag uses multiple containers:
1. **Web Container**: Handles HTTP requests
2. **Worker Container**: Processes async jobs (import, export, etc.)
3. **PostgreSQL**: Main data storage
4. **Redis**: Cache and job queue

## Common Tasks

### Create Admin User
```bash
kubectl exec -n wallabag deployment/wallabag -- \
  su -c "php bin/console wallabag:user:create --super-admin" -s /bin/sh www-data
```

### Import Articles
1. Login to Wallabag
2. Go to Import section
3. Choose import source
4. Upload file or provide credentials

### Configure Mobile App
1. Go to API clients management
2. Create new client
3. Use credentials in mobile app

### Clear Cache
```bash
kubectl exec -n wallabag deployment/wallabag -- \
  su -c "php bin/console cache:clear --env=prod" -s /bin/sh www-data
```

## Troubleshooting

```bash
# Check pods status
kubectl get pods -n wallabag

# View web logs
kubectl logs -n wallabag -l app=wallabag,component=web

# View worker logs  
kubectl logs -n wallabag -l app=wallabag,component=worker

# Check database connection
kubectl exec -n wallabag deployment/wallabag -- \
  su -c "php bin/console doctrine:schema:validate" -s /bin/sh www-data

# Restart all components
kubectl rollout restart deployment -n wallabag
```

## Maintenance

### Database Migrations
```bash
# Run migrations after updates
kubectl exec -n wallabag deployment/wallabag -- \
  su -c "php bin/console doctrine:migrations:migrate --no-interaction" -s /bin/sh www-data
```

### Clean Old Entries
```bash
# Remove old entries (customize days)
kubectl exec -n wallabag deployment/wallabag -- \
  su -c "php bin/console wallabag:clean-entries --days=365" -s /bin/sh www-data
```

## Backup

Important data to backup:
1. PostgreSQL database
2. Images volume (`/var/www/wallabag/web/assets/images`)
3. Export all articles periodically

## Known Issues

- Large imports may timeout - use async import
- PDF export requires sufficient memory
- Some sites may not parse correctly - check site config