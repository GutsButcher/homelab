# Sonarr

Sonarr is a TV series collection manager that automatically searches for and downloads episodes based on your quality preferences.

## Overview

Sonarr provides:
- Automatic TV episode downloading
- Series and season monitoring
- Quality upgrades for existing episodes
- Calendar view of upcoming episodes
- Smart episode title parsing
- Season pack support

**Official Documentation**: https://wiki.servarr.com/sonarr

## Access

- **URL**: https://sonarr.gwynbliedd.com
- **Authentication**: Configured during setup
- **API Access**: For integration with Jellyseerr

## Integration with Media Stack

Sonarr's role in the automation pipeline:
1. **Jellyseerr** sends TV series requests to Sonarr
2. **Sonarr** searches for episodes via Prowlarr
3. **Prowlarr** queries configured indexers
4. **Sonarr** sends downloads to qBittorrent
5. **Sonarr** monitors download progress
6. **Sonarr** imports completed episodes to Jellyfin library

## Features

### Series Management
- Monitor entire series or specific seasons
- Track episode air dates
- Automatic search for missing episodes
- Multi-language support
- Anime support with absolute numbering

### Automation
- RSS monitoring for new episodes
- Automatic quality upgrades
- Failed download handling
- Season pack preferences
- Custom post-processing scripts

### Organization
- Automatic file renaming
- Proper season/episode structure
- Metadata and artwork downloading
- Subtitle file handling

## Configuration

### Initial Setup
1. **Download Client**
   - Settings > Download Clients
   - Add qBittorrent
   - Host: `qbittorrent.qbittorrent.svc.cluster.local`
   - Port: 8080

2. **Indexers**
   - Automatically synced from Prowlarr
   - Verify in Settings > Indexers

3. **Media Management**
   - Settings > Media Management
   - Enable "Rename Episodes"
   - Configure episode format:
   ```
   {Series Title} - S{season:00}E{episode:00} - {Episode Title}
   ```

4. **Quality Profiles**
   - Settings > Profiles
   - Configure for different show types
   - Set upgrade preferences

## Common Tasks

### Add Series
1. Series > Add New
2. Search for series
3. Select:
   - Quality Profile
   - Root Folder
   - Monitor options
4. Click "Add Series"

### Monitor Options
- **All Episodes**: Download all episodes
- **Future Episodes**: Only new episodes
- **Missing Episodes**: Catch up on missed
- **Existing Episodes**: Skip what you have
- **None**: Add but don't download

### Manual Episode Search
1. Go to series page
2. Select season/episode
3. Click search icon
4. Interactive search
5. Choose release

### Upcoming Episodes
1. Calendar view
2. See air dates
3. Monitor schedule
4. Plan storage

## File Organization

```
/data/media/tv/
└── Series Name/
    ├── Season 01/
    │   ├── Series Name - S01E01 - Episode Title.mkv
    │   ├── Series Name - S01E02 - Episode Title.mkv
    │   └── ...
    └── Season 02/
        └── ...
```

## Troubleshooting

```bash
# Check Sonarr pod
kubectl get pods -n sonarr

# View logs
kubectl logs -n sonarr -l app.kubernetes.io/name=sonarr

# Check series count
kubectl exec -n sonarr deployment/sonarr -- \
  sqlite3 /config/sonarr.db "SELECT COUNT(*) FROM Series;"

# Test indexer search
kubectl exec -n sonarr deployment/sonarr -- \
  curl -s http://prowlarr.prowlarr.svc.cluster.local:9696/api/v1/health

# Restart Sonarr
kubectl rollout restart deployment sonarr -n sonarr
```

## Best Practices

### Quality Management
1. Different profiles for different shows:
   - Daily shows: Lower quality
   - Premium series: Higher quality
   - Anime: Special handling

2. Season Pack Preference
   - Enable for completed seasons
   - Saves bandwidth
   - Better organization

### Storage Planning
1. TV shows need more space than movies
2. Plan for entire series
3. Monitor growth rate
4. Use quality limits wisely

### Monitoring
1. Use calendar for planning
2. Set up notifications
3. Monitor RSS sync
4. Check activity regularly

## Maintenance

### Database Backup
```bash
# Backup Sonarr database
kubectl exec -n sonarr deployment/sonarr -- \
  cp /config/sonarr.db /config/backups/sonarr_$(date +%Y%m%d).db
```

### Series Refresh
1. Series > Mass Editor
2. Select series
3. Update and scan

### Clear Old Episodes
1. Consider unmonitoring old series
2. Remove ended shows
3. Archive if needed

## Advanced Features

### Custom Formats
- Configure for specific releases
- HDR preferences
- Audio format requirements
- Group preferences

### Release Profiles
- Preferred words
- Must contain
- Must not contain
- Tag restrictions

### Import Lists
- Trakt lists
- IMDb lists
- Custom lists
- Auto-add from lists

## Anime Configuration

For anime series:
1. Use appropriate quality profile
2. Enable preferred release groups
3. Configure dual audio preferences
4. Set absolute numbering if needed

## Related Links

- [Sonarr Wiki](https://wiki.servarr.com/sonarr)
- [V4 Documentation](https://wiki.servarr.com/sonarr/settings-v4)
- [FAQ](https://wiki.servarr.com/sonarr/faq)
- [Release Profiles](https://wiki.servarr.com/sonarr/settings#release-profiles)