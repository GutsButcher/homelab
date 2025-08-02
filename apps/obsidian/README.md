# Obsidian LiveSync

Self-hosted synchronization solution for Obsidian notes using CouchDB as the backend.

## Overview

Obsidian LiveSync provides:
- Real-time synchronization between devices
- End-to-end encryption option
- Conflict resolution
- Version history
- Plugin and theme sync
- Attachment support

**Official Documentation**: https://github.com/vrtmrz/obsidian-livesync

## Status

⚠️ **Note**: This application appears to be disabled (not included in apps/kustomization.yaml). It may have been added and then removed based on git history.

## Features

### Synchronization
- Live sync across devices
- Selective sync options
- Customizable sync intervals
- Conflict detection
- Merge strategies

### Security
- Optional E2E encryption
- Password protection
- Self-hosted data
- No third-party access

### Compatibility
- Works with Obsidian desktop
- Mobile app support
- Multiple vault support
- Plugin compatibility

## Configuration

If re-enabling, requires:
1. CouchDB backend setup
2. Obsidian plugin installation
3. Connection configuration
4. Sync settings

## Setup Steps

1. **Server Side**
   - Deploy CouchDB
   - Configure authentication
   - Set up HTTPS access
   - Create database

2. **Client Side**
   - Install LiveSync plugin
   - Configure server URL
   - Set credentials
   - Choose sync options

## Common Issues

- Sync conflicts
- Large file handling
- Plugin compatibility
- Mobile restrictions

## Alternative Solutions

If not using LiveSync:
- Obsidian Sync (official)
- Git-based sync
- Syncthing
- Cloud storage sync

## Re-enabling

To re-enable this application:
1. Add to `/apps/kustomization.yaml`
2. Configure CouchDB backend
3. Update ingress settings
4. Test synchronization

## Related Links

- [LiveSync Plugin](https://github.com/vrtmrz/obsidian-livesync)
- [Setup Guide](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/setup_own_server.md)
- [Troubleshooting](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/troubleshooting.md)