# Radarr

Radarr is a movie collection manager that automatically searches for and downloads movies based on your quality preferences.

## Overview

Radarr provides:
- Automatic movie downloading and organization
- Quality upgrades when available
- Custom quality profiles
- Release monitoring and automation
- Integration with download clients
- Metadata and artwork management

**Official Documentation**: https://wiki.servarr.com/radarr

## Access

- **URL**: https://radarr.gwynbliedd.com
- **Authentication**: Configured during setup
- **API Access**: For integration with Jellyseerr

## Integration with Media Stack

Radarr's role in the automation pipeline:
1. **Jellyseerr** sends movie requests to Radarr
2. **Radarr** searches for releases via Prowlarr
3. **Prowlarr** queries configured indexers
4. **Radarr** sends download to qBittorrent
5. **Radarr** monitors download progress
6. **Radarr** imports completed movie to Jellyfin library

## Features

### Movie Management
- Add movies manually or via lists
- Monitor for new releases
- Automatic search on add
- Quality profile management
- Custom naming schemes
- Metadata downloading

### Automation
- RSS sync for new releases
- Automatic upgrades
- Failed download handling
- Custom scripts support
- Recycle bin for safety

### Integration
- Multiple download client support
- Prowlarr for indexers
- Jellyfin notifications
- Webhook support
- Mobile app support

## Configuration

### Initial Setup
1. **Download Client**
   - Settings > Download Clients
   - Add qBittorrent
   - Host: `qbittorrent.qbittorrent.svc.cluster.local`
   - Port: 8080

2. **Indexers**
   - Automatically synced from Prowlarr
   - Check Settings > Indexers

3. **Media Management**
   - Settings > Media Management
   - Enable "Rename Movies"
   - Configure naming format
   - Set permissions

4. **Quality Profiles**
   - Settings > Profiles
   - Configure preferred qualities
   - Set upgrade rules

## Common Tasks

### Add Movie
1. Movies > Add New
2. Search for movie
3. Select quality profile
4. Choose root folder
5. Click "Add Movie"

### Import Existing Library
1. Movies > Import
2. Select folder
3. Map to movies
4. Import

### Manual Search
1. Select movie
2. Click "Search"
3. Interactive search
4. Choose release
5. Download

### Manage Quality Profiles
```
Common profiles:
- HD-1080p: For standard viewing
- 4K: For 4K displays
- Any: Space-conscious
```

## File Organization

```
/data/media/movies/
└── Movie Name (Year)/
    ├── Movie Name (Year).mkv
    ├── Movie Name (Year).en.srt
    └── Movie Name (Year)-poster.jpg
```

## Troubleshooting

```bash
# Check Radarr pod
kubectl get pods -n radarr

# View logs
kubectl logs -n radarr -l app.kubernetes.io/name=radarr

# Check download client connection
kubectl exec -n radarr deployment/radarr -- \
  curl -s http://qbittorrent.qbittorrent.svc.cluster.local:8080/api/v2/app/version

# Database queries
kubectl exec -n radarr deployment/radarr -- \
  sqlite3 /config/radarr.db "SELECT COUNT(*) FROM Movies;"

# Restart Radarr
kubectl rollout restart deployment radarr -n radarr
```

## Best Practices

### Quality Settings
1. Use appropriate quality for your display
2. Consider bandwidth and storage
3. Set cutoff for upgrades
4. Configure proper codecs

### Storage
1. Use consistent naming
2. Keep adequate free space
3. Monitor disk usage
4. Use recycle bin

### Performance
1. Limit RSS sync interval
2. Configure download limits
3. Use indexer priorities
4. Monitor system resources

## Maintenance

### Database Backup
```bash
# Backup Radarr database
kubectl exec -n radarr deployment/radarr -- \
  cp /config/radarr.db /config/backups/radarr_$(date +%Y%m%d).db
```

### Clear Blocklist
1. Activity > Blocklist
2. Select entries
3. Remove from blocklist

### Update Library
1. System > Tasks
2. Run "Refresh Movie"
3. Check for issues

## Advanced Configuration

### Custom Scripts
- Settings > Connect
- Add custom scripts for:
  - On Download
  - On Upgrade
  - On Rename

### Lists
- Settings > Lists
- Add IMDb lists
- Trakt lists
- Custom lists

## Related Links

- [Radarr Wiki](https://wiki.servarr.com/radarr)
- [Quick Start Guide](https://wiki.servarr.com/radarr/quick-start-guide)
- [FAQ](https://wiki.servarr.com/radarr/faq)
- [Custom Formats](https://wiki.servarr.com/radarr/settings#custom-formats)