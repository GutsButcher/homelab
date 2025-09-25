# Vaultwarden Configuration Enhancements

This document contains the configuration tasks and procedures for securing and optimizing Vaultwarden.

## Task 1: Configure Signup Restrictions

### Goal
Prevent open registration - only allow specific users or invited users to create accounts.

### Configuration Options

#### Option A: Completely Disable Signups (Most Secure)
```yaml
vaultwarden:
  signup:
    allowed: false        # No one can sign up
    verify: true         # Email verification still required for invites
```

#### Option B: Domain Whitelist (Recommended)
```yaml
vaultwarden:
  signup:
    allowed: true
    verify: true
    domainWhitelist: "gwynbliedd.com,gmail.com"  # Only these email domains can register
```

#### Option C: Admin-Only Invitations
```yaml
vaultwarden:
  signup:
    allowed: false       # Disable public signups
  invitations:
    allowed: true        # Allow admin to invite users
    orgName: "Gwynbliedd Vault"
    expirationHours: 48  # Invitation expires in 48 hours
```

### Implementation Steps

1. Edit `/apps/vaultwarden/prod/vaultwarden/helmrelease-patch.yaml`
2. Add under `vaultwarden:` section:
```yaml
signup:
  allowed: false
  verify: true
invitations:
  allowed: true
  orgName: "Gwynbliedd Vault"
```

## Task 2: Configure Gmail SMTP

### Prerequisites
1. Gmail account: abdulla.amash@gmail.com
2. App-specific password (required for Gmail with 2FA)
   - Go to: https://myaccount.google.com/apppasswords
   - Create app password for "Mail"
   - Save the 16-character password

### Configuration

#### Create SMTP Secret
```bash
# Create the secret with Gmail SMTP password
kubectl create secret generic vaultwarden-smtp \
  --from-literal=smtp-password='YOUR_APP_PASSWORD_HERE' \
  --from-literal=smtp-user='abdulla.amash@gmail.com' \
  -n vaultwarden --dry-run=client -o yaml > smtp-secret.yaml

# Seal the secret
kubeseal --format=yaml < smtp-secret.yaml > smtp-sealed-secret.yaml

# Apply
kubectl apply -f smtp-sealed-secret.yaml
```

#### Update Helm Values
Add to `/apps/vaultwarden/prod/vaultwarden/helmrelease-patch.yaml`:

```yaml
vaultwarden:
  email:
    smtp:
      host: "smtp.gmail.com"
      from: "abdulla.amash@gmail.com"
      fromName: "Gwynbliedd Vault"
      security: "force_tls"    # Gmail requires TLS
      port: 465                # SSL/TLS port
      username: "abdulla.amash@gmail.com"
      auth: "Login"            # Gmail uses Login auth
      acceptInvalidCertificates: false
      acceptInvalidHostnames: false
      requireDeviceEmail: true # Email on new device login
      existingSecret:
        name: "vaultwarden-smtp"
        # Note: The secret should contain 'username' and 'password' keys
```

## Task 3: Websocket Configuration

### What is Websocket in Vaultwarden?
- Enables real-time sync between devices
- Port: 3012 (default)
- Required for instant push notifications
- Allows live sync of vault changes

### Current Status
- Websocket is enabled in the container (port 3012)
- Not exposed through service/ingress

### Implementation Options

#### Option A: Through Cloudflare Tunnel (Recommended)
```yaml
# Add to Cloudflare Tunnel configuration:
# Public hostname: vaultwarden-ws.gwynbliedd.com
# Service: http://192.168.100.210:3012
# Or use the same domain with path: vaultwarden.gwynbliedd.com/notifications/hub
```

#### Option B: Add to Service and IngressRoute
```yaml
# In service configuration
service:
  port: 80
  extraPorts:
    - name: websocket
      port: 3012
      targetPort: 3012

# In IngressRoute (if not using Cloudflare Tunnel)
# Would need separate route for websocket
```

### Testing Websocket
1. Open Vaultwarden web vault
2. Open browser developer console (F12)
3. Go to Network tab
4. Look for WebSocket connections to `/notifications/hub`
5. Should show "101 Switching Protocols" if working

## Task 4: Future Enhancements

### 4.1 Argon2 Admin Token

#### What is Argon2?
- Modern password hashing algorithm
- More secure than plain text tokens
- Resistant to GPU cracking attacks

#### Generate Argon2 Token
```bash
# Method 1: Using Vaultwarden container
kubectl exec -it vaultwarden-0 -n vaultwarden -- /vaultwarden hash

# Method 2: Using Docker locally
docker run --rm -it vaultwarden/server:latest /vaultwarden hash

# Enter your desired admin password when prompted
# Copy the generated Argon2 hash
```

#### Update Configuration
```yaml
vaultwarden:
  adminToken:
    value: "$argon2id$v=19$m=65540,t=3,p=4$YOUR_GENERATED_HASH_HERE"
    # Or use existingSecret (recommended)
```

### 4.2 Two-Factor Authentication Options

#### Built-in 2FA Methods
1. **TOTP (Time-based One-Time Password)**
   - Works with apps like Google Authenticator, Authy
   - Already enabled by default
   
2. **Email 2FA**
   - Requires SMTP configuration (Task 2)
   - Auto-enabled when SMTP is configured
   ```yaml
   vaultwarden:
     email:
       twoFactor:
         enforceInviteVerification: true
         autoFallback: true  # Use email as backup 2FA
   ```

3. **WebAuthn/FIDO2**
   - Hardware security keys (YubiKey, etc.)
   - Already enabled by default

#### Advanced 2FA Options

**YubiKey OTP Configuration:**
```yaml
vaultwarden:
  auth:
    yubikey:
      enable: true
      clientId: "GET_FROM_YUBICO"      # https://upgrade.yubico.com/getapikey/
      clientSecret: "GET_FROM_YUBICO"
      server: ""  # Leave empty for default
```

**Duo Security (Enterprise):**
```yaml
vaultwarden:
  auth:
    duo:
      enable: true
      integrationKey: "YOUR_DUO_IKEY"
      secretKey: "YOUR_DUO_SKEY"
      host: "api-xxxxx.duosecurity.com"
```

### 4.3 Additional Security Hardening

```yaml
vaultwarden:
  # Password policies
  passwords:
    iterations: 600000        # Increase from 350000 for better security
    hintsAllowed: false      # Don't allow password hints
    showHint: false          # Never show hints on login page
  
  # Restrict organization creation
  orgCreationUsers: "abdulla.amash@gmail.com"  # Only you can create orgs
  
  # Login rate limiting
  limits:
    logins:
      ratelimitSeconds: 60
      ratelimitMaxBurst: 5   # Reduce from 10
      adminRatelimitSeconds: 300
      adminRatelimitMaxBurst: 2
  
  # Icon security (prevent internal network scanning)
  icons:
    disableDownloading: false
    blacklistNonGlobalIPs: true
    blacklistRegex: '^(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$'
```

### 4.4 Resource Limits and Health Probes

```yaml
resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 256Mi

livenessProbe:
  enabled: true
  httpGet:
    path: /alive
    port: 80
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  enabled: true
  httpGet:
    path: /alive
    port: 80
  initialDelaySeconds: 10
  periodSeconds: 5
```

## Implementation Priority

1. **Immediate** (Do Now):
   - Disable open signups
   - Configure SMTP for email notifications

2. **Short Term** (This Week):
   - Generate and apply Argon2 admin token
   - Test websocket connectivity
   - Enable health probes

3. **Long Term** (When Needed):
   - Configure YubiKey if you have one
   - Set up automated backups
   - Resource monitoring and limits

## Testing Checklist

- [ ] Verify signup is restricted
- [ ] Test email sending (password reset)
- [ ] Confirm new device login emails work
- [ ] Check admin panel access with new token
- [ ] Test 2FA enrollment
- [ ] Verify websocket sync between devices
- [ ] Monitor resource usage

## Backup Considerations

### Database Backup
```bash
# Manual backup of PostgreSQL
kubectl exec -it vaultwarden-postgres-1 -n vaultwarden -- \
  pg_dump -U vaultwarden vaultwarden > vaultwarden_backup_$(date +%Y%m%d).sql
```

### Attachments Backup
```bash
# Backup PVC data
kubectl cp vaultwarden/vaultwarden-0:/data ./vaultwarden_data_backup_$(date +%Y%m%d)
```

## Monitoring Commands

```bash
# Check logs
kubectl logs -n vaultwarden vaultwarden-0 -f

# Check events
kubectl get events -n vaultwarden --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pod -n vaultwarden

# Test SMTP
kubectl exec -it vaultwarden-0 -n vaultwarden -- \
  /vaultwarden send-test-email abdulla.amash@gmail.com
```