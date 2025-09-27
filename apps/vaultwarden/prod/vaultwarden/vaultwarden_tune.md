# Vaultwarden Configuration - Completed & Future Plans

## Current Status (Completed September 2025)

### ✅ Implemented Features

1. **Signup Restrictions** - Admin-only invitations enabled
2. **Gmail SMTP** - Email notifications configured and working
3. **Websocket Support** - Real-time sync active on port 3012
4. **Mobile Compatibility** - Updated to v1.34.3, mobile app working
5. **Security** - Restricted access, email verification enabled

### 📊 Current Configuration

```yaml
# Active configuration in helmrelease-patch.yaml
vaultwarden:
  domain: "vaultwarden.gwynbliedd.com"
  image:
    tag: "1.34.3-alpine"
  signup:
    allowed: false
    verify: true
  invitations:
    allowed: true
    orgName: "Gwynbliedd Vault"
  email:
    smtp: [configured with Gmail]
  database:
    type: postgresql
    existingSecret: db-secret
  websocket:
    enabled: true
    port: 3012
```

## Future Enhancement Plans

### 1. Argon2 Admin Token (Security Enhancement)

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

### 2. Two-Factor Authentication Enhancements

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

### 3. Advanced Security Hardening

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

### 4. Resource Optimization

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

### 5. Automated Backup Strategy

#### Database Backup Script
```bash
#!/bin/bash
# Automated PostgreSQL backup with retention
BACKUP_DIR="/backups/vaultwarden"
RETENTION_DAYS=30

# Create backup
kubectl exec -it vaultwarden-postgres-1 -n vaultwarden -- \
  pg_dump -U vaultwarden vaultwarden > $BACKUP_DIR/vaultwarden_$(date +%Y%m%d_%H%M%S).sql

# Clean old backups
find $BACKUP_DIR -name "vaultwarden_*.sql" -mtime +$RETENTION_DAYS -delete
```

#### Attachments Backup
```bash
# Schedule PVC data backup
kubectl create cronjob vaultwarden-backup --schedule="0 2 * * *" \
  --image=busybox -- /bin/sh -c \
  "kubectl cp vaultwarden/vaultwarden-0:/data /backup/vaultwarden_data_$(date +%Y%m%d)"
```

## Implementation Priority

### Phase 1: Security (When Time Permits)
- [ ] Implement Argon2 admin token
- [ ] Enable 2FA for vault access
- [ ] Review and strengthen password policies

### Phase 2: Reliability (Next Month)
- [ ] Add health probes and resource limits
- [ ] Set up automated backups
- [ ] Implement monitoring alerts

### Phase 3: Advanced Features (Future)
- [ ] YubiKey support if hardware acquired
- [ ] Organization features for family sharing
- [ ] Advanced audit logging

## Quick Reference - Monitoring Commands

```bash
# Check logs
kubectl logs -n vaultwarden deployment/vaultwarden -f

# Check events  
kubectl get events -n vaultwarden --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pod -n vaultwarden

# Verify websocket connectivity
curl -I -H "Host: vaultwarden.gwynbliedd.com" \
  -H "Upgrade: websocket" -H "Connection: Upgrade" \
  http://192.168.100.210/notifications/hub

# Access admin panel
# URL: https://vaultwarden.gwynbliedd.com/admin
# Token: kubectl get secret admin-token -n vaultwarden -o jsonpath='{.data.token}' | base64 -d
```

## Success Metrics

- ✅ All Bitwarden clients working (web, mobile, extensions)
- ✅ Real-time sync via websocket
- ✅ Email notifications functional
- ✅ Secure admin-only registration
- ✅ Mobile app compatibility restored

## Notes

- Current version: Vaultwarden 1.34.3-alpine
- Database: PostgreSQL via CloudNative PG
- Access: Via Cloudflare Tunnel only
- Resource usage: ~100MB RAM (efficient!)

---
*Last updated: September 2025*
*Status: Production Ready*