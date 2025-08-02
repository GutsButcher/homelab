# Monitoring Stack

This directory contains the monitoring infrastructure for the homelab, currently consisting of Prometheus for metrics collection.

## Overview

The monitoring stack provides:
- Metrics collection from all services
- Long-term metrics storage
- Alerting capabilities (when configured)
- Integration with visualization tools

## Components

### Prometheus
The core metrics collection system that:
- Scrapes metrics from configured endpoints
- Stores time-series data
- Provides PromQL query language
- Integrates with Kubernetes service discovery

## Current Configuration

- **Namespace**: monitoring
- **Retention**: Configured for homelab scale
- **Scrape Configs**: Auto-discovery of Kubernetes services
- **Storage**: Persistent volume for metrics retention

## Metrics Sources

Prometheus automatically discovers and scrapes:
- Kubernetes system components
- Node metrics (via node-exporter)
- Container metrics
- Application metrics (when exposed)
- Traefik metrics
- CNPG PostgreSQL metrics

## Access

While Prometheus has a basic UI, metrics are typically viewed through:
- Grafana dashboards (if deployed)
- Direct PromQL queries
- Alert manager (if configured)

## Future Enhancements

Potential additions to the monitoring stack:
1. **Grafana**: Visualization dashboards
2. **Alertmanager**: Alert routing and notifications
3. **Loki**: Log aggregation
4. **Tempo**: Distributed tracing

## Useful Queries

```promql
# CPU usage by namespace
sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)

# Memory usage by pod
sum(container_memory_usage_bytes) by (pod)

# HTTP request rate (Traefik)
sum(rate(traefik_service_requests_total[5m])) by (service)

# PostgreSQL connections (CNPG)
cnpg_backends_total
```

## Troubleshooting

```bash
# Check Prometheus status
kubectl get pods -n monitoring

# View Prometheus targets
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# Check service discovery
kubectl get servicemonitors -A

# View Prometheus logs
kubectl logs -n monitoring -l app=prometheus
```