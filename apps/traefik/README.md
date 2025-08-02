# Traefik

Traefik is a modern HTTP reverse proxy and load balancer that serves as the main ingress controller for the homelab cluster.

## Overview

Traefik handles all incoming traffic to the cluster with:
- Automatic HTTPS with Let's Encrypt
- Dynamic configuration from Kubernetes CRDs
- Built-in monitoring and metrics
- Middleware for authentication, rate limiting, and more

## Architecture

- **LoadBalancer Service**: Exposed via MetalLB
- **IngressRoute CRD**: Custom resource for routing configuration
- **Middleware**: Reusable components for auth, headers, etc.
- **TLS Termination**: Automatic certificate management

## Key Features in Use

### 1. Automatic HTTPS
All services automatically receive TLS certificates through cert-manager integration.

### 2. Middleware
Common middleware configurations:
- **Basic Auth**: Password protection for sensitive services
- **Rate Limiting**: Prevent abuse
- **Headers**: Security headers and CORS
- **Redirects**: HTTP to HTTPS

### 3. IngressRoute
More flexible than standard Ingress:
```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRoute
metadata:
  name: app-ingress
spec:
  routes:
  - match: Host(`app.gwynbliedd.com`)
    kind: Rule
    services:
    - name: app-service
      port: 80
    middlewares:
    - name: basic-auth
```

## Dashboard Access

- **URL**: https://traefik.gwynbliedd.com
- **Authentication**: Enabled via middleware
- **Features**: Route visualization, metrics, health checks

## Configuration

Deployed via Helm with custom values:
- Prometheus metrics enabled
- Access logs for debugging
- Custom error pages
- Resource limits

## Monitoring

```bash
# Check Traefik pods
kubectl get pods -n traefik

# View IngressRoutes
kubectl get ingressroutes -A

# Check certificates
kubectl get certificates -A

# View Traefik logs
kubectl logs -n traefik -l app.kubernetes.io/name=traefik
```

## Common Tasks

### Add Basic Auth to Service
1. Create htpasswd secret
2. Create middleware referencing secret
3. Add middleware to IngressRoute

### Debug Routing Issues
1. Check IngressRoute syntax
2. Verify service endpoints
3. Review Traefik dashboard
4. Check pod logs