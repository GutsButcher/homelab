# Gwent Game

A web-based implementation of the Gwent card game, self-hosted for personal use.

## Overview

This deployment hosts a Gwent card game application, providing:
- Web-based card game interface
- Multiplayer capabilities
- Game state persistence
- Card collection management

## Access

- **URL**: https://gwent.gwynbliedd.com
- **Authentication**: Configured within the application
- **Game Modes**: Single player and multiplayer

## Architecture

The Gwent game uses a unique directory structure:
```
gwent-game/
└── base/
    └── game/     # Nested 'game' directory
        └── gwent-game/
            ├── deployment.yaml
            ├── service.yaml
            └── kustomization.yaml
└── prod/
    └── game/
        └── gwent-game/
            ├── ingressroute.yaml
            └── kustomization.yaml
```

## Configuration

Deployed using Kustomize with:
- Base deployment configuration
- Service exposure
- Traefik IngressRoute for HTTPS access
- Resource limits for stable performance

## Features

### Game Mechanics
- Full Gwent ruleset implementation
- Card collection system
- Deck building interface
- Match history

### Technical Features
- Persistent game state
- WebSocket for real-time gameplay
- RESTful API for game actions
- Responsive web design

## Deployment Details

The application is deployed with:
- Single replica deployment
- ClusterIP service
- HTTPS via Traefik ingress
- Configured resource limits

## Common Tasks

### Check Application Status
```bash
# View pod status
kubectl get pods -n gwent-game

# Check logs
kubectl logs -n gwent-game -l app=gwent-game

# Restart application
kubectl rollout restart deployment gwent-game -n gwent-game
```

### Database Management
If the game uses a database:
```bash
# Check database connections
kubectl exec -n gwent-game deployment/gwent-game -- /app/check-db.sh
```

## Troubleshooting

### Connection Issues
1. Verify pod is running
2. Check service endpoints
3. Validate IngressRoute configuration
4. Review application logs

### Performance Issues
1. Check resource usage
2. Review memory limits
3. Monitor response times
4. Scale if necessary

## Maintenance

### Updates
1. Check for new game versions
2. Backup game data if persistent
3. Update container image
4. Test functionality

### Monitoring
- Monitor resource usage
- Track active connections
- Review error logs
- Check game performance

## Notes

- The nested directory structure (`game/gwent-game`) is unique to this application
- Ensure proper path references in kustomization files
- Game data persistence depends on application configuration