# MailHog

SMTP sink for testing email from homelab apps (Treelink uses it for verification,
password reset and security-alert emails). Nothing leaves the cluster: MailHog
accepts mail on port 1025 and shows it in a web UI on port 8025.

- In-cluster SMTP: `smtp://mailhog.mailhog.svc.cluster.local:1025` (no auth, no TLS)
- UI: https://mailhog.gwynbliedd.com behind the Authentik forward-auth middleware
- API (for automated checks): `kubectl -n mailhog port-forward svc/mailhog 8025:8025`
  then `GET http://localhost:8025/api/v2/search?kind=to&query=<address>`
- Storage is in-memory; messages disappear when the pod restarts.
