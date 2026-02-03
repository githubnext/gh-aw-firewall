# Docker Image Verification

All published Docker images are signed with [cosign](https://github.com/sigstore/cosign) using keyless signing. You can verify the signatures to ensure image authenticity and integrity.

## Installing Cosign

### Package Managers (Recommended)

```bash
# Homebrew (macOS/Linux)
brew install cosign

# Debian/Ubuntu
sudo apt update && sudo apt install -y cosign
```

See the [official installation guide](https://docs.sigstore.dev/cosign/installation/) for all installation options.

### Direct Download

```bash
# Quick install for testing (verify checksums from GitHub release page for production)
curl -sSfL https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64 -o cosign
chmod +x cosign
sudo mv cosign /usr/local/bin/
```

## Verifying Image Signatures

All images are signed using GitHub Actions OIDC tokens, ensuring they come from the official repository.

### Verify Squid Image

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/github/gh-aw-firewall/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/github/gh-aw-firewall/squid:latest
```

### Verify Agent Image

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/github/gh-aw-firewall/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/github/gh-aw-firewall/agent:latest
```

## Verifying SBOM Attestations

Images include Software Bill of Materials (SBOM) attestations for supply chain transparency.

```bash
cosign verify-attestation \
  --certificate-identity-regexp 'https://github.com/github/gh-aw-firewall/.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --type spdxjson \
  ghcr.io/github/gh-aw-firewall/squid:latest
```

## What Gets Signed

- **Image Signatures**: Cryptographic signatures proving the image was built by the official GitHub Actions workflow
- **SBOM Attestations**: Software Bill of Materials in SPDX JSON format, listing all dependencies and components
- **Transparency Log**: All signatures are recorded in Sigstore's Rekor transparency log

## Security Benefits

- **Image Authenticity**: Verify images come from the official repository
- **Supply Chain Security**: SBOM attestations provide transparency about image contents
- **Keyless Signing**: Uses GitHub Actions OIDC tokens (no secret keys to manage)
- **Reproducible Builds**: GitHub Actions pinned to commit hashes prevent supply chain attacks
