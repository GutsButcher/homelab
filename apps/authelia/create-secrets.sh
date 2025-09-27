#!/bin/bash

# Generate secrets for Authelia
echo "Setting up Authelia secrets..."

# Generate random JWT secret (minimum 64 characters)
JWT_SECRET=$(openssl rand -hex 64)

# Generate random session secret (minimum 64 characters)
SESSION_SECRET=$(openssl rand -hex 64)

# Generate random storage encryption key
STORAGE_KEY=$(openssl rand -hex 32)

# Prompt for password
echo "Enter password for user 'gwynbliedd':"
read -s PASSWORD
echo

# Generate Argon2id hash using docker
echo "Generating password hash..."
PASSWORD_HASH=$(docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password "$PASSWORD" | grep "Digest:" | sed 's/Digest: //')

if [ -z "$PASSWORD_HASH" ]; then
    echo "Failed to generate password hash. Make sure Docker is running."
    exit 1
fi

# Create the Kubernetes secret
kubectl create secret generic authelia-secrets \
    --namespace=authelia \
    --from-literal=JWT_TOKEN="$JWT_SECRET" \
    --from-literal=SESSION_SECRET="$SESSION_SECRET" \
    --from-literal=STORAGE_ENCRYPTION_KEY="$STORAGE_KEY" \
    --dry-run=client -o yaml > authelia-secrets.yaml

echo "Secret YAML created at authelia-secrets.yaml"
echo ""
echo "Password hash generated:"
echo "$PASSWORD_HASH"
echo ""
echo "Now update the users-configmap.yaml with this password hash."
echo "Replace the PLACEHOLDER values in the password field with:"
echo "$PASSWORD_HASH"
echo ""
echo "Then apply the secret with:"
echo "kubectl apply -f authelia-secrets.yaml"