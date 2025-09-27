# Adding a Service to Authentik Protection

This guide explains how to protect any service in your homelab with Authentik Single Sign-On (SSO).

## Prerequisites

- Authentik deployed and accessible at `https://auth.gwynbliedd.com`
- Service deployed with a Traefik IngressRoute
- Admin access to Authentik UI

## Important Configuration

### Authentik Environment Variables (Required!)

Ensure these environment variables are set on your Authentik deployment:

```yaml
env:
  - name: AUTHENTIK_HOST
    value: https://auth.gwynbliedd.com
  - name: AUTHENTIK_HOST_BROWSER
    value: https://auth.gwynbliedd.com
```

Without these, Authentik will redirect to `0.0.0.0:9000` instead of your domain.

## Step-by-Step Guide

### Step 1: Create Provider in Authentik UI

1. Login to Authentik at `https://auth.gwynbliedd.com`
2. Navigate to **Applications > Providers**
3. Click **Create** and select **Proxy Provider**
4. Configure:
   - **Name**: `<service-name>` (e.g., `Homepage`)
   - **Authorization flow**: `default-provider-authorization-implicit-consent`
   - **Mode**: `Forward auth (single application)`
   - **External host**: `https://<service>.gwynbliedd.com`
5. Under **Advanced protocol settings**:
   - **Issuer mode**: `Based on the request`
6. Click **Create**

### Step 2: Create Application in Authentik UI

1. Navigate to **Applications > Applications**
2. Click **Create**
3. Configure:
   - **Name**: `<service-name>`
   - **Slug**: `<service-name>` (auto-generated)
   - **Provider**: Select the provider you just created
   - **UI Settings** (optional):
     - **Icon**: Upload service icon
     - **Launch URL**: `https://<service>.gwynbliedd.com`
     - **Description**: Brief description
4. Click **Create**

### Step 3: Add Application to Embedded Outpost

1. Navigate to **Outposts > Outposts**
2. Click on **authentik Embedded Outpost**
3. In **Applications**, select your newly created application
4. Click **Update**

**Note**: If you see a warning "authentik domain is not configured", check:
- **System > Brands > authentik-default**
- Ensure **Domain** is set to `auth.gwynbliedd.com`

### Step 4: Create ForwardAuth Middleware for Service

Create a middleware file for your service:

```yaml
# apps/<service>/prod/<service>/authentik-middleware.yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: authentik-forwardauth
  namespace: <service-namespace>
spec:
  forwardAuth:
    address: http://authentik-server.authentik.svc.cluster.local/outpost.goauthentik.io/auth/traefik
    trustForwardHeader: true
    authResponseHeadersRegex: ^X-authentik-
    authResponseHeaders:
      - X-authentik-username
      - X-authentik-groups
      - X-authentik-email
      - X-authentik-name
      - X-authentik-uid
      - X-authentik-jwt
      - X-authentik-meta-jwks
      - X-authentik-meta-outpost
      - X-authentik-meta-provider
      - X-authentik-meta-app
      - X-authentik-meta-version
```

### Step 5: Update IngressRoute

Update your service's IngressRoute to use the middleware:

```yaml
# apps/<service>/prod/<service>/ingressroute.yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: <service>
  namespace: <service-namespace>
spec:
  entryPoints:
    - web
  routes:
    - match: Host(`<service>.gwynbliedd.com`)
      kind: Rule
      services:
        - name: <service>
          port: <service-port>
      middlewares:
        - name: authentik-forwardauth
          namespace: <service-namespace>
```

### Step 6: Update Kustomization

Update the service's kustomization to include the middleware:

```yaml
# apps/<service>/prod/<service>/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
  - authentik-middleware.yaml
  - ingressroute.yaml
  # ... other resources
```

### Step 7: Apply Changes

```bash
# Commit and push changes
git add .
git commit -m "Add Authentik protection to <service>"
git push

# Force Flux reconciliation
flux reconcile kustomization apps --with-source

# Or apply directly
kubectl apply -k apps/<service>/prod/
```

## Testing

1. Visit `https://<service>.gwynbliedd.com`
2. You should be redirected to `https://auth.gwynbliedd.com` for authentication
3. After successful login, you'll be redirected back to your service

## Troubleshooting

### Issue: Redirects to 0.0.0.0:9000 or 127.0.0.1:9000

**Solution**: Set the environment variables on Authentik:

```bash
kubectl set env deployment/authentik-server -n authentik \
  AUTHENTIK_HOST=https://auth.gwynbliedd.com \
  AUTHENTIK_HOST_BROWSER=https://auth.gwynbliedd.com

kubectl set env deployment/authentik-worker -n authentik \
  AUTHENTIK_HOST=https://auth.gwynbliedd.com \
  AUTHENTIK_HOST_BROWSER=https://auth.gwynbliedd.com

# Restart pods
kubectl rollout restart deployment -n authentik
```

### Issue: "Not Found" page without CSS/JS

**Solution**: Check that:
1. The Brand domain is correctly set to `auth.gwynbliedd.com`
2. The provider's **Issuer mode** is set to "Based on the request"
3. The application is added to the embedded outpost

### Issue: 404 on /outpost.goauthentik.io/auth/traefik

**Solution**: Ensure the application is added to the embedded outpost (Step 3)

### Issue: Authentication loop

**Solution**: Check that:
1. The external host in the provider matches your service URL
2. Session cookies are properly configured for `.gwynbliedd.com` domain
3. Clear browser cookies and try again

## Example: Homepage Protection

Here's what we did for Homepage:

1. Created Provider: `Homepage` with external host `https://home.gwynbliedd.com`
2. Created Application: `Homepage` linked to the provider
3. Added to embedded outpost
4. Created `authentik-middleware.yaml` in `apps/homepage/prod/homepage/`
5. Updated IngressRoute to use the middleware
6. Removed old basic-auth middleware

## Additional Security Options

### Require 2FA
In the provider settings, you can require 2FA by selecting a different authorization flow that enforces MFA.

### Group-based Access
Create policies in Authentik to restrict access based on user groups.

### Time-based Access
Create policies that only allow access during certain hours.

## Notes

- Always use HTTPS for external hosts
- The middleware address uses the internal Kubernetes service URL
- ForwardAuth headers starting with `X-authentik-` contain user information
- Applications can read these headers to identify the authenticated user