# Jellyseerr

Jellyseerr is a media request management and discovery tool built specifically for Jellyfin, allowing users to request movies and TV shows.

## Overview

Jellyseerr provides:
- Beautiful, intuitive interface for media discovery
- Integration with Jellyfin for user authentication
- Automated requests to Radarr and Sonarr
- Request approval workflow
- Trending and popular media discovery
- Multi-language support

**Official Documentation**: https://docs.jellyseerr.dev/

## Access

- **URL**: https://jellyseerr.gwynbliedd.com
- **Authentication**: Jellyfin SSO or local accounts
- **Admin Panel**: Available for configured administrators

## Integration with Media Stack

Jellyseerr connects the entire media automation pipeline:
1. **Users** browse and request content via Jellyseerr
2. **Jellyseerr** sends approved requests to Radarr/Sonarr
3. **Radarr/Sonarr** search for content via Prowlarr
4. **qBittorrent** downloads the content
5. **Jellyfin** serves the content to users

## Features

### Discovery
- Browse trending movies and shows
- Search across multiple sources
- View detailed media information
- Check availability in Jellyfin
- See request status

### Request Management
- Simple request interface
- Approval workflows
- Request notifications
- User quotas
- Request history

### Integration
- Jellyfin authentication
- Radarr/Sonarr automation
- Discord/Email notifications
- Mobile-friendly interface

## Configuration

Key settings to configure:
1. **Jellyfin Integration**
   - Server URL: http://jellyfin.jellyfin.svc.cluster.local:8096
   - API key from Jellyfin
   - User import settings

2. **Radarr Integration**
   - URL: http://radarr.radarr.svc.cluster.local:7878
   - API key
   - Quality profiles
   - Root folders

3. **Sonarr Integration**
   - URL: http://sonarr.sonarr.svc.cluster.local:8989
   - API key
   - Quality profiles
   - Root folders

## Common Tasks

### Initial Setup
```bash
# 1. Access Jellyseerr web UI
# 2. Complete setup wizard
# 3. Connect Jellyfin instance
# 4. Configure Radarr/Sonarr
# 5. Set up notifications
```

### Manage User Permissions
1. Settings > Users
2. Click on user
3. Configure:
   - Request limits
   - Auto-approve
   - Admin access

### Configure Quality Profiles
1. Settings > Radarr/Sonarr
2. Select default quality profile
3. Set default root folder
4. Configure anime settings (if applicable)

### Set Up Notifications
1. Settings > Notifications
2. Add notification agent
3. Configure triggers:
   - Request submitted
   - Request approved
   - Media available

## Troubleshooting

```bash
# Check Jellyseerr pod
kubectl get pods -n jellyseerr

# View logs
kubectl logs -n jellyseerr -l app.kubernetes.io/name=jellyseerr

# Test Jellyfin connection
kubectl exec -n jellyseerr deployment/jellyseerr -- \
  curl -s http://jellyfin.jellyfin.svc.cluster.local:8096/System/Info

# Test Radarr connection
kubectl exec -n jellyseerr deployment/jellyseerr -- \
  curl -s http://radarr.radarr.svc.cluster.local:7878/api/v3/system/status

# Restart Jellyseerr
kubectl rollout restart deployment jellyseerr -n jellyseerr
```

## User Workflow

1. **Browse**: Users explore trending content
2. **Search**: Find specific movies or shows
3. **Request**: Submit content requests
4. **Approval**: Admins review (if required)
5. **Download**: Automated via Radarr/Sonarr
6. **Notify**: Users informed when available

## Database

Jellyseerr uses SQLite by default for:
- User preferences
- Request history
- Cache data
- Application settings

## Best Practices

1. Configure reasonable request limits
2. Set up quality profiles appropriately
3. Use approval workflow for new users
4. Monitor disk space on media storage
5. Regular database backups
6. Configure notifications for admins

## Maintenance

### Backup Database
```bash
# Backup SQLite database
kubectl exec -n jellyseerr deployment/jellyseerr -- \
  cp /app/config/db/db.sqlite3 /app/config/db/db.sqlite3.backup
```

### Clear Cache
```bash
# Clear image cache if needed
kubectl exec -n jellyseerr deployment/jellyseerr -- \
  rm -rf /app/config/cache/*
```

## Related Links

- [Jellyseerr Documentation](https://docs.jellyseerr.dev/)
- [API Documentation](https://docs.jellyseerr.dev/api-reference)
- [GitHub Repository](https://github.com/Fallenbagel/jellyseerr)