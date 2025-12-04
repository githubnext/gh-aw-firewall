#!/bin/bash
# Script to generate ephemeral CA certificate for Squid SSL bumping
# This certificate is used for man-in-the-middle interception of HTTPS traffic
# for debugging/investigation purposes only.

set -e

CERT_DIR="/etc/squid/ssl_cert"
CERT_FILE="$CERT_DIR/squid.pem"
DB_DIR="/var/lib/squid/ssl_db"

# Create directories if they don't exist
mkdir -p "$CERT_DIR"
mkdir -p "$DB_DIR"

# Check if certificate already exists
if [ -f "$CERT_FILE" ]; then
    echo "SSL certificate already exists at $CERT_FILE"
    exit 0
fi

echo "Generating ephemeral CA certificate for SSL bumping..."

# Generate private key and self-signed certificate
# Valid for 365 days, 2048-bit RSA key
openssl req -new -newkey rsa:2048 -sha256 -days 365 -nodes -x509 \
    -keyout "$CERT_FILE" \
    -out "$CERT_FILE" \
    -subj "/C=US/ST=State/L=City/O=AWF/OU=Proxy/CN=AWF Squid Proxy CA"

# Set proper permissions
chmod 600 "$CERT_FILE"
chown proxy:proxy "$CERT_FILE"
chown -R proxy:proxy "$CERT_DIR"

echo "Certificate generated successfully at $CERT_FILE"

# Initialize SSL database for certificate caching
echo "Initializing SSL certificate database..."
/usr/lib/squid/security_file_certgen -c -s "$DB_DIR" -M 4MB
chown -R proxy:proxy "$DB_DIR"

echo "SSL bumping setup complete"
