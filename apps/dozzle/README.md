# Dozzle

Dozzle is a lightweight, web-based Docker log viewer that provides real-time log monitoring for all containers in your cluster.

## Overview

Dozzle provides:
- Real-time log streaming
- Multi-container log viewing
- Search and filter capabilities
- No database or storage required
- Minimal resource footprint
- Mobile-friendly interface

**Official Documentation**: https://dozzle.dev/

## Access

- **URL**: https://dozzle.gwynbliedd.com
- **Authentication**: Optional (can be configured)
- **Read-only**: No container control capabilities

## Features

### Log Viewing
- Real-time streaming logs
- Color-coded output
- Timestamp display
- Multi-container split view
- Full-screen mode

### Search & Filter
- Search within logs
- Filter by container
- Filter by log level
- Regular expression support
- Clear filters quickly

### Interface
- Dark/Light theme
- Responsive design
- Keyboard shortcuts
- Container statistics
- Health status indicators

## Configuration

Dozzle is deployed with:
- Read-only Docker socket mount
- Minimal resource allocation
- Optional authentication
- TLS via Traefik

### Security Considerations
- Read-only access to Docker socket
- No container management capabilities
- Optional basic authentication
- HTTPS-only access

## Common Use Cases

### Troubleshooting
1. Quick container log access
2. Real-time error monitoring
3. Multi-container debugging
4. Performance issue investigation

### Monitoring
1. Watch application startup
2. Monitor background jobs
3. Track scheduled tasks
4. Observe integration issues

## Keyboard Shortcuts

- `/` - Focus search
- `Esc` - Clear search
- `f` - Toggle fullscreen
- `t` - Toggle timestamp
- `w` - Toggle wrap

## Container Filtering

Filter containers by:
- Name pattern
- Status (running/exited)
- Labels
- Custom filters

## Troubleshooting

```bash
# Check Dozzle pod
kubectl get pods -n dozzle

# View Dozzle logs (meta!)
kubectl logs -n dozzle -l app.kubernetes.io/name=dozzle

# Verify Docker socket access
kubectl exec -n dozzle deployment/dozzle -- ls -la /var/run/docker.sock

# Restart Dozzle
kubectl rollout restart deployment dozzle -n dozzle
```

## Best Practices

1. **Security**
   - Use read-only socket mount
   - Enable authentication if public
   - Monitor access logs

2. **Performance**
   - Limit simultaneous streams
   - Use search instead of scrolling
   - Close unused tabs

3. **Usage**
   - Bookmark frequently viewed containers
   - Use split view for related services
   - Export logs when needed

## Limitations

- No log persistence
- No log aggregation
- Real-time only
- No alerting capabilities

## Alternatives & Complements

While Dozzle is great for real-time viewing:
- **Loki**: For log aggregation
- **Elasticsearch**: For log analysis
- **Prometheus**: For metrics
- **Grafana**: For visualization

## Tips & Tricks

### Quick Debugging
1. Open multiple containers in tabs
2. Use split view for request flow
3. Filter by error/warn levels
4. Search for correlation IDs

### Performance Monitoring
1. Watch for error patterns
2. Monitor startup times
3. Check memory warnings
4. Observe connection issues

## Related Links

- [Dozzle Documentation](https://dozzle.dev/)
- [GitHub Repository](https://github.com/amir20/dozzle)
- [Configuration Guide](https://dozzle.dev/guide/getting-started)
- [Release Notes](https://github.com/amir20/dozzle/releases)