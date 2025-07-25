#!/bin/bash
# Create the secret with your credentials
kubectl create secret generic pgadmin-credentials \
  --namespace=pgadmin \
  --from-literal=email="example@gmail.com" \
  --from-literal=password="SuperSecretPassowrd"