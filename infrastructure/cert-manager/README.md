# Cert-Manager

Cert-Manager automates the management and issuance of TLS certificates from various issuing sources within Kubernetes.

## Overview

This directory is currently empty but reserved for cert-manager configuration. Cert-manager handles:
- Automatic certificate provisioning from Let's Encrypt
- Certificate renewal before expiration
- Integration with Kubernetes Ingress resources
- Support for multiple certificate authorities

## Planned Configuration

When implemented, this directory will contain:
- ClusterIssuer for Let's Encrypt (production and staging)
- Certificate resources for wildcard domains
- DNS challenge configuration for wildcard certificates
- Certificate monitoring and alerts

## Current Status

Cert-manager appears to be deployed in the cluster but the configuration is managed elsewhere. This directory structure exists for future migration to a more organized approach.

## Implementation Plan

1. Create HelmRelease for cert-manager
2. Configure ClusterIssuer for Let's Encrypt
3. Set up DNS challenge solver (for wildcard certs)
4. Create Certificate resources
5. Update Traefik IngressRoutes to use cert-manager certificates

## Usage with Applications

Applications in this cluster use cert-manager annotations on their IngressRoutes:
```yaml
metadata:
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
```

This automatically provisions TLS certificates for each application subdomain.