# qBittorrent

qBittorrent is a free and open-source BitTorrent client that serves as the download client for the media automation stack.

## Overview

qBittorrent provides:
- Clean web interface for torrent management
- Integrated search engine
- RSS support with filtering
- IP filtering and encryption
- Bandwidth scheduling
- Category-based organization

**Official Documentation**: https://www.qbittorrent.org/

## Access

- **URL**: https://qbittorrent.gwynbliedd.com
- **Default Login**: admin/adminadmin (change immediately!)
- **API Access**: For Radarr/Sonarr integration

## Integration with Media Stack

qBittorrent's role:
1. **Radarr/Sonarr** send torrent files/magnets
2. **qBittorrent** downloads content
3. **Categories** separate movies/TV/etc
4. **Completed downloads** are imported by Radarr/Sonarr
5. **Seeding** continues per configured rules

## Features

### Download Management
- Priority queue system
- Category organization
- Tag support
- Move on completion
- Automatic torrent management

### Performance
- Sequential downloading
- Bandwidth limits
- Connection limits
- Scheduling
- Proxy support

### Security
- Encryption support
- IP filtering
- Web UI authentication
- API security

## Configuration

### Initial Setup
1. **Change Default Password**
   - Tools > Options > Web UI
   - Update username/password

2. **Download Paths**
   - Configure categories:
   ```
   Movies → /downloads/movies
   TV → /downloads/tv
   ```

3. **Connection Settings**
   - Set appropriate limits
   - Configure port
   - Enable UPnP/NAT-PMP if needed

4. **BitTorrent Settings**
   - Seeding limits
   - Share ratio goals
   - Queue settings

### Radarr/Sonarr Integration
In Radarr/Sonarr:
- Host: `qbittorrent.qbittorrent.svc.cluster.local`
- Port: `8080`
- Username/Password: As configured
- Category: `movies` or `tv`

## Common Tasks

### Monitor Downloads
1. Check active transfers
2. View speeds and peers
3. Check ratio/seed time
4. Manage queue priority

### Manage Categories
1. View panel > Categories
2. Right-click to create
3. Set save paths
4. Assign to downloads

### Clear Completed
1. Select completed torrents
2. Right-click > Remove
3. Choose to delete files or not

### Pause/Resume
- Individual torrent control
- Global pause/resume
- Scheduled pausing

## Storage Management

```
/downloads/
├── movies/
│   ├── incomplete/
│   └── complete/
├── tv/
│   ├── incomplete/
│   └── complete/
└── torrents/
    └── .torrent files
```

## Troubleshooting

```bash
# Check qBittorrent pod
kubectl get pods -n qbittorrent

# View logs
kubectl logs -n qbittorrent -l app.kubernetes.io/name=qbittorrent

# Check disk space
kubectl exec -n qbittorrent deployment/qbittorrent -- df -h /downloads

# Verify permissions
kubectl exec -n qbittorrent deployment/qbittorrent -- ls -la /downloads

# Restart qBittorrent
kubectl rollout restart deployment qbittorrent -n qbittorrent
```

## Performance Tuning

### Connection Settings
```
Global maximum connections: 200
Maximum connections per torrent: 50
Global upload slots: 10
Upload slots per torrent: 4
```

### Advanced Settings
- Enable OS cache
- Send upload piece suggestions
- Coalesce reads & writes
- Use piece extent affinity

### Bandwidth Management
1. Set global limits if needed
2. Alternative rate limits
3. Schedule for off-peak
4. Limit local peer discovery

## Security Best Practices

1. **Authentication**
   - Strong password
   - Consider IP whitelisting
   - Disable bypass for localhost

2. **Encryption**
   - Require encryption
   - Enable anonymous mode if needed

3. **Network**
   - Use VPN if required
   - Configure SOCKS5 proxy
   - Enable IP filtering

## Maintenance

### Clean Up
```bash
# Remove old incomplete downloads
kubectl exec -n qbittorrent deployment/qbittorrent -- \
  find /downloads/incomplete -mtime +7 -delete

# Clear torrent backup
kubectl exec -n qbittorrent deployment/qbittorrent -- \
  find /config/qBittorrent/BT_backup -name "*.torrent" -mtime +30 -delete
```

### Backup Configuration
```bash
# Backup qBittorrent config
kubectl exec -n qbittorrent deployment/qbittorrent -- \
  tar -czf /config/backup.tar.gz /config/qBittorrent/
```

### Monitor Disk Usage
```bash
# Check download directory size
kubectl exec -n qbittorrent deployment/qbittorrent -- \
  du -sh /downloads/*
```

## Advanced Features

### RSS Feeds
1. View > RSS Reader
2. Add feed URLs
3. Set up filters
4. Auto-download rules

### Search Plugins
1. View > Search
2. Search plugins > Update
3. Enable desired plugins
4. Search directly in client

### Web API
- Enable for external tools
- API documentation in wiki
- Used by Radarr/Sonarr

## Integration Tips

1. **Categories**: Always use for organization
2. **Completed Folder**: Enable for better handling
3. **Seeding**: Balance ratio with disk space
4. **Monitoring**: Watch for stalled downloads
5. **Cleanup**: Regular maintenance prevents issues

## Related Links

- [qBittorrent Wiki](https://github.com/qbittorrent/qBittorrent/wiki)
- [WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1))
- [Configuration Guide](https://github.com/qbittorrent/qBittorrent/wiki/Explanation-of-Options)