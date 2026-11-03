# Isolated Chatwoot server — staged canonical manifests

These base/prod definitions are the homelab copy of the tested private source at
`bc8ff10fc9cf262cc733a7c11d34e20b8b9059bc`. `source-provenance.json` records the
initial copied bytes; it is provenance, not an assertion that later edits are
unchanged.

No Argo Application is registered for this path yet. Publishing this directory
alone does not activate Chatwoot. Keep existing paused apps, ERP and CNPG intact.

Before activation, verify live capacity/storage, securely provision namespaced
runtime/owner secrets, run migrations and owner bootstrap, and establish a real
public HTTPS route. The official Android client is `com.chatwoot.app`; keep the
upstream push relay enabled. No custom APK or owner Firebase project is needed.

Validate this exact tree through the private project's validator:

```text
python server/scripts/validate.py --manifest-root <homelab>/apps/hupo-chat
```

Once activated, this homelab path is authoritative. CI must select and test it,
including its runtime scripts, rather than validating an unrelated private copy.
Static/CI passes do not certify deployment or a real phone notification.
