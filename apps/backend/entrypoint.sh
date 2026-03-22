#!/bin/sh
set -e

# Create certs directory if it doesn't exist
mkdir -p /app/certs

# Generate self-signed certificate if it doesn't exist
if [ ! -f /app/certs/localhost.crt ] || [ ! -f /app/certs/localhost.key ]; then
  echo "Generating self-signed SSL certificate..."
  openssl req \
    -new \
    -x509 \
    -newkey rsa:2048 \
    -sha256 \
    -nodes \
    -keyout /app/certs/localhost.key \
    -days 3560 \
    -out /app/certs/localhost.crt \
    -subj "/C=US/ST=State/L=City/O=VibePlant/CN=localhost"
  echo "SSL certificate generated successfully"
fi

# Start the NestJS application
exec node dist/main.js
