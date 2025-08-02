# Glances

Glances is a cross-platform system monitoring tool that provides a comprehensive overview of system resources through a web interface.

## Overview

Glances provides:
- Real-time system monitoring
- CPU, memory, disk, and network statistics
- Process monitoring with sorting
- Container and service monitoring
- Alert system for thresholds
- RESTful JSON API

**Official Documentation**: https://glances.readthedocs.io/

## Access

- **URL**: https://glances.gwynbliedd.com
- **Authentication**: Optional basic auth
- **API Endpoint**: Available for integrations

## Features

### System Monitoring
- CPU usage (per-core and total)
- Memory and swap usage
- Disk I/O rates
- Network interface statistics
- File system usage
- System uptime and load

### Process Monitoring
- Process list with filtering
- CPU/Memory usage per process
- Automatic sorting options
- Process tree view
- Container statistics

### Alerts
- Configurable thresholds
- Color-coded warnings
- Alert history
- Custom alert actions

## Interface

### Web UI Sections
1. **System Summary**: Quick overview
2. **CPU**: Detailed CPU metrics
3. **Memory**: RAM and swap details
4. **Network**: Interface statistics
5. **Disk I/O**: Read/write rates
6. **File Systems**: Mount points
7. **Processes**: Running processes
8. **Containers**: Docker statistics

### Display Modes
- Full mode: All information
- Reduced mode: Essential metrics
- Minimal mode: Critical only

## Configuration

Glances configuration options:
- Update interval
- Alert thresholds
- Displayed sections
- Export settings
- Plugin configuration

### Alert Thresholds
```yaml
# Example thresholds
cpu_careful: 50
cpu_warning: 70
cpu_critical: 90

mem_careful: 50
mem_warning: 70
mem_critical: 90
```

## API Usage

```bash
# Get system stats
curl https://glances.gwynbliedd.com/api/3/all

# Get CPU info
curl https://glances.gwynbliedd.com/api/3/cpu

# Get process list
curl https://glances.gwynbliedd.com/api/3/processlist
```

## Integration

### Homepage Widget
Glances integrates with Homepage dashboard:
- CPU usage
- Memory usage
- Disk usage
- Network rates
- Temperature (if available)

### Monitoring Stack
Export metrics to:
- Prometheus
- InfluxDB
- StatsD
- MQTT

## Common Tasks

### Monitor High CPU
1. Check process list
2. Sort by CPU usage
3. Identify culprit
4. Take action

### Check Memory Leaks
1. Monitor memory trends
2. Check swap usage
3. Identify growing processes
4. Investigate cause

### Disk Space Issues
1. Check file systems
2. Sort by usage
3. Identify full disks
4. Clean up space

## Troubleshooting

```bash
# Check Glances pod
kubectl get pods -n glances

# View logs
kubectl logs -n glances -l app.kubernetes.io/name=glances

# Test API access
kubectl exec -n glances deployment/glances -- \
  curl -s localhost:61208/api/3/status

# Restart Glances
kubectl rollout restart deployment glances -n glances
```

## Performance Impact

Glances is designed to be lightweight:
- Minimal CPU usage
- Low memory footprint
- Efficient data collection
- Configurable update rates

## Best Practices

### Monitoring
1. Set appropriate alert thresholds
2. Use minimal mode for dashboards
3. Configure update intervals
4. Monitor trends over time

### Security
1. Enable authentication for public access
2. Limit API access if needed
3. Use HTTPS only
4. Monitor access logs

### Resource Usage
1. Adjust refresh rate based on needs
2. Disable unused plugins
3. Limit history retention
4. Use appropriate export intervals

## Advanced Features

### Export Options
- CSV files
- JSON format
- Time-series databases
- Custom scripts

### Docker Integration
- Container CPU/Memory
- Network statistics
- Container count
- Image information

### Custom Plugins
- Write Python plugins
- Add custom metrics
- Integrate external data
- Create custom alerts

## Keyboard Shortcuts (CLI)

When using CLI version:
- `a` - Auto sort processes
- `c` - Sort by CPU
- `m` - Sort by memory
- `d` - Show/hide disk I/O
- `f` - Show/hide file systems
- `n` - Show/hide network
- `q` - Quit

## Related Links

- [Glances Documentation](https://glances.readthedocs.io/)
- [GitHub Repository](https://github.com/nicolargo/glances)
- [API Documentation](https://glances.readthedocs.io/en/latest/api.html)
- [Configuration Guide](https://glances.readthedocs.io/en/latest/config.html)