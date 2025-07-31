# Sealed Secrets

Sealed Secrets provides a way to encrypt secrets that can be stored in Git repositories safely. The SealedSecret can only be decrypted by the controller running in the cluster.

## Installation

The sealed-secrets controller is deployed automatically via FluxCD when changes are pushed to the main branch.

## Usage

### Install kubeseal CLI

```bash
# Download the latest release
wget https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.27.2/kubeseal-0.27.2-linux-amd64.tar.gz
tar -xvzf kubeseal-0.27.2-linux-amd64.tar.gz
sudo install -m 755 kubeseal /usr/local/bin/kubeseal

# Or using brew on macOS
brew install kubeseal
```

### Creating a Sealed Secret

1. Create a regular Kubernetes secret manifest (do not apply it):
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mysecret
  namespace: default
type: Opaque
data:
  username: YWRtaW4=  # base64 encoded
  password: MWYyZDFlMmU2N2Rm  # base64 encoded
```

2. Seal the secret:
```bash
# Using the controller's public key
kubeseal --format yaml < secret.yaml > sealedsecret.yaml

# Or pipe from kubectl create secret
echo -n mypassword | kubectl create secret generic mysecret --dry-run=client --from-file=password=/dev/stdin -o yaml | kubeseal -o yaml > sealedsecret.yaml
```

3. Apply the sealed secret:
```bash
kubectl apply -f sealedsecret.yaml
```

4. The controller will decrypt it and create the actual Secret resource.

### Converting Existing Secrets

For existing secrets in the cluster:

```bash
# Export existing secret
kubectl get secret mysecret -n mynamespace -o yaml > secret.yaml

# Seal it
kubeseal --format yaml < secret.yaml > sealedsecret.yaml

# Delete the original secret
kubectl delete secret mysecret -n mynamespace

# Apply the sealed secret
kubectl apply -f sealedsecret.yaml
```

### Scope

By default, sealed secrets are scoped to namespace and name. This means:
- A sealed secret can only be unsealed in the namespace it was sealed for
- The name must match exactly

To create cluster-wide or namespace-wide sealed secrets:
```bash
# Cluster-wide (can be unsealed in any namespace with any name)
kubeseal --scope cluster-wide --format yaml < secret.yaml > sealedsecret.yaml

# Namespace-wide (can be unsealed with any name in the specified namespace)
kubeseal --scope namespace-wide --format yaml < secret.yaml > sealedsecret.yaml
```

### Troubleshooting

Check controller logs:
```bash
kubectl logs -n sealed-secrets -l app.kubernetes.io/name=sealed-secrets
```

Get controller version:
```bash
kubeseal --version
```

### Backup

The controller's private key is stored in a secret named `sealed-secrets-key` in the `sealed-secrets` namespace. This should be backed up securely as it's required to decrypt all sealed secrets.

```bash
kubectl get secret -n sealed-secrets sealed-secrets-key -o yaml > sealed-secrets-key-backup.yaml
```

## Examples for this Homelab

### PostgreSQL Secrets
```bash
# Create PostgreSQL secret
kubectl create secret generic postgres-secret \
  --namespace=myapp \
  --from-literal=username=myuser \
  --from-literal=password=mypassword \
  --dry-run=client -o yaml | kubeseal -o yaml > apps/myapp/base/myapp/postgres-sealed-secret.yaml
```

### Basic Auth for Traefik
```bash
# Generate htpasswd
htpasswd -nb admin mypassword > auth

# Create secret and seal it
kubectl create secret generic basic-auth \
  --namespace=myapp \
  --from-file=auth \
  --dry-run=client -o yaml | kubeseal -o yaml > apps/myapp/prod/myapp/basic-auth-sealed.yaml
```