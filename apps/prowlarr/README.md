# Prowlarr

Prowlarr is an indexer manager that integrates with Radarr and Sonarr, providing a single place to manage all your indexers.

## Overview

Prowlarr provides:
- Centralized indexer management
- Automatic sync to Radarr/Sonarr
- Indexer health monitoring
- Search aggregation across indexers
- Statistics and history tracking
- Support for 500+ indexers

**Official Documentation**: https://wiki.servarr.com/prowlarr

## Access

- **URL**: https://prowlarr.gwynbliedd.com
- **Authentication**: Configured during setup
- **API Access**: For integration with other services

## Integration with Media Stack

Prowlarr serves as the indexer hub:
1. **Prowlarr** manages all indexer configurations
2. **Radarr/Sonarr** sync indexers from Prowlarr
3. **Search requests** are distributed across indexers
4. **Results** are aggregated and returned
5. **Statistics** track indexer performance

## Features

### Indexer Management
- Support for Usenet and Torrent indexers
- Built-in indexer definitions
- Custom indexer support via Cardigann
- Automatic category mapping
- Indexer-specific settings

### Integration
- Auto-sync to *arr applications
- Manual search interface
- API for third-party apps
- RSS feed generation
- Search result caching

### Monitoring
- Indexer health checks
- Response time tracking
- Success rate statistics
- Error logging
- Rate limit management

## Configuration

### Initial Setup
1. Access Prowlarr UI
2. Set authentication method
3. Add indexers
4. Configure apps (Radarr/Sonarr)
5. Test synchronization

### Add Indexer
1. Settings > Indexers > Add
2. Search for indexer
3. Configure:
   - API key/credentials
   - Categories to sync
   - Priority/limits

### Connect to Radarr/Sonarr
1. Settings > Apps > Add
2. Select Radarr or Sonarr
3. Enter:
   - Name
   - Sync Level
   - Server URL
   - API Key

## Common Tasks

### Test Indexer
```bash
# Via UI: Indexers > Select > Test
# Check connectivity and authentication
```

### Manual Search
1. Search tab
2. Enter query
3. Select categories
4. Review aggregated results

### Sync Issues
1. Check Settings > Apps
2. Verify API keys
3. Test connection
4. Force sync

### View Statistics
1. History tab
2. Filter by:
   - Indexer
   - Success/Failure
   - Time period

## Troubleshooting

```bash
# Check Prowlarr pod
kubectl get pods -n prowlarr

# View logs
kubectl logs -n prowlarr -l app.kubernetes.io/name=prowlarr

# Check database
kubectl exec -n prowlarr deployment/prowlarr -- \
  sqlite3 /config/prowlarr.db "SELECT COUNT(*) FROM Indexers;"

# Test indexer connectivity
kubectl exec -n prowlarr deployment/prowlarr -- \
  curl -I https://example-indexer.com

# Restart Prowlarr
kubectl rollout restart deployment prowlarr -n prowlarr
```

## Best Practices

### Indexer Configuration
1. Use API keys over credentials when possible
2. Configure appropriate rate limits
3. Enable only needed categories
4. Monitor indexer health
5. Remove non-functional indexers

### Performance
1. Limit concurrent searches
2. Configure search timeouts
3. Use caching effectively
4. Monitor response times

### Security
1. Use strong authentication
2. Limit API access
3. Regular credential rotation
4. Monitor access logs

## Maintenance

### Database Backup
```bash
# Backup Prowlarr database
kubectl exec -n prowlarr deployment/prowlarr -- \
  cp /config/prowlarr.db /config/prowlarr.db.backup
```

### Clear Cache
```bash
# Clear search cache
kubectl exec -n prowlarr deployment/prowlarr -- \
  rm -rf /config/cache/*
```

### Update Indexer Definitions
- Prowlarr auto-updates definitions
- Manual update via System > Updates

## Configuration Files

Key configuration locations:
- `/config/prowlarr.db` - Main database
- `/config/logs/` - Application logs
- `/config/Backups/` - Automatic backups

## Integration URLs

When configuring in Radarr/Sonarr:
- **Prowlarr URL**: `http://prowlarr.prowlarr.svc.cluster.local:9696`
- **API Key**: Found in Settings > General

## Related Links

- [Prowlarr Wiki](https://wiki.servarr.com/prowlarr)
- [Quick Start Guide](https://wiki.servarr.com/prowlarr/quick-start-guide)
- [Supported Indexers](https://wiki.servarr.com/prowlarr/supported-indexers)
- [FAQ](https://wiki.servarr.com/prowlarr/faq)