# Jellyfin

Jellyfin is a free and open-source media server that enables you to organize, stream, and access your media collection from any device.

## Overview

Jellyfin provides:
- Stream movies, TV shows, music, and photos
- No subscription fees or tracking
- Cross-platform client support
- Hardware-accelerated transcoding
- Live TV and DVR functionality
- User management with parental controls

**Official Documentation**: https://jellyfin.org/docs/

## Access

- **URL**: https://jellyfin.gwynbliedd.com
- **Authentication**: User accounts with configurable permissions
- **Admin Dashboard**: Available for administrator accounts

## Integration with Media Stack

Jellyfin is the centerpiece of the media automation stack:
- **Jellyseerr**: Users request media through Jellyseerr
- **Radarr/Sonarr**: Automatically download requested content
- **qBittorrent**: Downloads managed by Radarr/Sonarr
- **Prowlarr**: Provides indexers to Radarr/Sonarr

## Features

### Media Organization
- Automatic metadata fetching
- Custom collections and playlists
- Multi-library support
- Subtitle management
- Chapter markers

### Streaming
- Direct play when possible
- Adaptive bitrate streaming
- Hardware transcoding support
- Mobile sync for offline viewing
- Multiple audio/subtitle tracks

### Clients
- Web interface
- Mobile apps (iOS/Android)
- TV apps (Android TV, Roku, etc.)
- Desktop apps
- Kodi integration

## Configuration

Deployed using Helm with:
- Persistent volumes for:
  - `/config`: Jellyfin configuration
  - `/data/media`: Media library location
  - `/cache`: Transcoding cache
- GPU passthrough for hardware acceleration (if available)
- Network configuration for optimal streaming

## Common Tasks

### Add Media Library
1. Access Settings > Libraries
2. Click "Add Media Library"
3. Choose content type
4. Add folder paths
5. Configure metadata providers

### Create User
1. Go to Dashboard > Users
2. Click "Add User"
3. Set username and password
4. Configure permissions and library access

### Enable Hardware Acceleration
1. Dashboard > Playback
2. Select hardware acceleration type
3. Configure codec support
4. Test with sample media

### Remote Access
1. Dashboard > Networking
2. Configure external access
3. Set up port forwarding if needed
4. Consider reverse proxy setup

## Storage Structure

```
/data/media/
├── movies/
│   └── Movie Name (Year)/
│       └── Movie Name (Year).mkv
├── tv/
│   └── Show Name/
│       └── Season 01/
│           └── S01E01 - Episode Name.mkv
├── music/
└── photos/
```

## Troubleshooting

```bash
# Check Jellyfin pod
kubectl get pods -n jellyfin

# View logs
kubectl logs -n jellyfin -l app.kubernetes.io/name=jellyfin

# Check transcoding
kubectl exec -n jellyfin deployment/jellyfin -- ls -la /config/cache/

# Restart Jellyfin
kubectl rollout restart deployment jellyfin -n jellyfin

# Check GPU access (if configured)
kubectl exec -n jellyfin deployment/jellyfin -- nvidia-smi
```

## Performance Tuning

### Transcoding
- Use hardware acceleration when available
- Pre-transcode for common devices
- Adjust thread count based on CPU
- Monitor cache disk usage

### Network
- Enable direct play on local network
- Configure proper bandwidth limits
- Use wired connections for 4K content

## Backup

Important data to backup:
1. `/config` directory (settings, metadata)
2. User preferences and watched status
3. Playlists and collections
4. Custom metadata

## Best Practices

1. Organize media following naming conventions
2. Use hardware transcoding to reduce CPU load
3. Regular library scans for new content
4. Monitor disk space for transcoding cache
5. Set up user permissions appropriately
6. Configure bandwidth limits for remote streaming

## Related Links

- [Jellyfin Documentation](https://jellyfin.org/docs/)
- [Hardware Acceleration](https://jellyfin.org/docs/general/administration/hardware-acceleration.html)
- [Naming Guide](https://jellyfin.org/docs/general/server/media/movies.html)