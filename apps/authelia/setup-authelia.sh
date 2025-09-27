#!/bin/bash

echo "Setting up Authelia..."

# Generate random secrets
JWT_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Create the secret
kubectl create secret generic authelia-secrets \
    --namespace=authelia \
    --from-literal=JWT_TOKEN="$JWT_SECRET" \
    --from-literal=SESSION_SECRET="$SESSION_SECRET" \
    --from-literal=STORAGE_ENCRYPTION_KEY="$STORAGE_ENCRYPTION_KEY" \
    --from-literal=STORAGE_PASSWORD="" \
    --from-literal=LDAP_PASSWORD="" \
    --from-literal=DUO_SECRET_KEY="" \
    --from-literal=REDIS_PASSWORD="" \
    --from-literal=REDIS_SENTINEL_PASSWORD="" \
    --from-literal=SMTP_PASSWORD="" \
    --from-literal=OIDC_HMAC_SECRET="" \
    --from-literal=OIDC_PRIVATE_KEY="" \
    --dry-run=client -o yaml > authelia-secrets.yaml

echo "Secrets generated and saved to authelia-secrets.yaml"

# Generate password hash
echo ""
echo "Enter password for user 'gwynbliedd':"
read -s PASSWORD
echo ""

# Generate hash using docker
echo "Generating password hash..."
HASH=$(docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password "$PASSWORD" 2>/dev/null | grep "Digest:" | sed 's/Digest: //')

if [ -z "$HASH" ]; then
    echo "Failed to generate password hash. Make sure Docker is running."
    exit 1
fi

echo ""
echo "Password hash generated successfully!"
echo ""
echo "Now update the password in apps/authelia/base/authelia/config.yaml"
echo "Replace the CHANGEME placeholders with:"
echo "$HASH"
echo ""
echo "Then apply with:"
echo "kubectl apply -f authelia-secrets.yaml"