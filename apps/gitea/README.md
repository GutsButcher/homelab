# Homepage

A modern, fully static, fast, secure fully proxied, highly customizable application dashboard with integrations for over 100 services.

## Overview

Homepage serves as the central dashboard for all services in the homelab, providing:
- Quick access to all applications
- Service health monitoring
- Widget integrations for various services
- Clean, customizable interface

## Access

- **URL**: https://homepage.gwynbliedd.com
- **Authentication**: Basic auth via Traefik middleware

## Configuration

Homepage is deployed using Helm with:
- ConfigMap for services configuration
- PVC for icons and custom assets
- Traefik IngressRoute with TLS

## Features

- **Service Discovery**: Automatically configured with homelab services
- **Status Monitoring**: Real-time health checks
- **Resource Usage**: CPU/Memory widgets
- **Weather Widget**: Local weather information
- **Search Integration**: Quick web search
- **Customizable Layout**: Organized by service categories

## Service Integration

Homepage connects to various services to display:
- Container status (via Docker socket)
- Media library statistics (Jellyfin, Radarr, Sonarr)
- Download queue information (qBittorrent)
- System resources (Glances)

## Customization

The configuration is managed through:
- `services.yaml`: Service definitions and groups
- `widgets.yaml`: Widget configuration
- `settings.yaml`: General settings and theme

## Troubleshooting

```bash
# Check pod status
kubectl get pods -n homepage

# View logs
kubectl logs -n homepage -l app.kubernetes.io/name=homepage

# Restart to apply config changes
kubectl rollout restart deployment homepage -n homepage
```