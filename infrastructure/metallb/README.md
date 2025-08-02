# MetalLB

MetalLB is a load-balancer implementation for bare metal Kubernetes clusters, using standard routing protocols.

## Overview

MetalLB provides a network load balancer implementation that integrates with standard network equipment, so that external services on bare metal clusters "just work".

## Configuration

MetalLB operates in Layer 2 mode for this homelab setup, providing:
- Automatic IP address assignment from configured pools
- ARP/NDP responses for service IPs
- Load balancing for services of type LoadBalancer

## Components

- **HelmRelease**: Deploys MetalLB controller and speakers
- **Default Values**: Base configuration
- **ConfigMap**: IP address pool configuration

## IP Address Management

The cluster uses a dedicated IP range for LoadBalancer services. This range should:
- Be within your local network subnet
- Not conflict with DHCP assignments
- Be reserved in your router configuration

## Usage

Services can request a LoadBalancer IP by setting:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: my-service
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 8080
```

## Integration with Traefik

While most services use Traefik ingress, MetalLB provides the LoadBalancer IP for Traefik itself, enabling external access to the cluster.

## Monitoring

```bash
# Check MetalLB pods
kubectl get pods -n metallb-system

# View allocated IPs
kubectl get svc -A | grep LoadBalancer

# Check MetalLB logs
kubectl logs -n metallb-system -l app=metallb
```

## Troubleshooting

Common issues:
- **No IP assigned**: Check IP pool configuration
- **IP conflicts**: Ensure IP range doesn't overlap with DHCP
- **ARP issues**: Verify speaker pods are running on all nodes