/**
 * SSL Bump utilities for HTTPS content inspection
 *
 * This module provides functionality to generate per-session CA certificates
 * for Squid SSL Bump mode, which enables URL path filtering for HTTPS traffic.
 *
 * Security considerations:
 * - CA key is stored only in workDir (tmpfs-backed in container)
 * - Certificate is valid for 1 day only
 * - Private key is never logged
 * - CA is unique per session
 */

import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import { logger } from './logger';

/**
 * Configuration for SSL Bump CA generation
 */
export interface SslBumpConfig {
  /** Working directory to store CA files */
  workDir: string;
  /** Common name for the CA certificate (default: 'AWF Session CA') */
  commonName?: string;
  /** Validity period in days (default: 1) */
  validityDays?: number;
}

/**
 * Result of CA generation containing paths to certificate files
 */
export interface CaFiles {
  /** Path to CA certificate (PEM format) */
  certPath: string;
  /** Path to CA private key (PEM format) */
  keyPath: string;
  /** DER format certificate for easy import */
  derPath: string;
}

/**
 * Generates a self-signed CA certificate for SSL Bump
 *
 * The CA certificate is used by Squid to generate per-host certificates
 * on-the-fly, allowing it to inspect HTTPS traffic for URL filtering.
 *
 * @param config - SSL Bump configuration
 * @returns Paths to generated CA files
 * @throws Error if OpenSSL commands fail
 */
export async function generateSessionCa(config: SslBumpConfig): Promise<CaFiles> {
  const { workDir, commonName = 'AWF Session CA', validityDays = 1 } = config;

  // Create ssl directory in workDir
  const sslDir = path.join(workDir, 'ssl');
  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true, mode: 0o700 });
  }

  const certPath = path.join(sslDir, 'ca-cert.pem');
  const keyPath = path.join(sslDir, 'ca-key.pem');
  const derPath = path.join(sslDir, 'ca-cert.der');

  logger.debug(`Generating SSL Bump CA certificate in ${sslDir}`);

  try {
    // Generate RSA private key and self-signed certificate in one command
    // Using -batch to avoid interactive prompts
    await execa('openssl', [
      'req',
      '-new',
      '-newkey', 'rsa:2048',
      '-days', validityDays.toString(),
      '-nodes', // No password on private key
      '-x509',
      '-subj', `/CN=${commonName}`,
      '-keyout', keyPath,
      '-out', certPath,
      '-batch',
    ]);

    // Set restrictive permissions on private key
    fs.chmodSync(keyPath, 0o600);
    fs.chmodSync(certPath, 0o644);

    logger.debug(`CA certificate generated: ${certPath}`);
    logger.debug(`CA private key generated: ${keyPath}`);

    // Generate DER format for easier import into trust stores
    await execa('openssl', [
      'x509',
      '-in', certPath,
      '-outform', 'DER',
      '-out', derPath,
    ]);

    fs.chmodSync(derPath, 0o644);
    logger.debug(`CA certificate (DER) generated: ${derPath}`);

    return { certPath, keyPath, derPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to generate SSL Bump CA: ${message}`);
  }
}

/**
 * Initializes Squid's SSL certificate database
 *
 * Squid requires a certificate database to store dynamically generated
 * certificates for SSL Bump mode.
 *
 * @param workDir - Working directory
 * @returns Path to the SSL database directory
 */
export async function initSslDb(workDir: string): Promise<string> {
  const sslDbPath = path.join(workDir, 'ssl_db');

  // Create directory if it doesn't exist
  if (!fs.existsSync(sslDbPath)) {
    fs.mkdirSync(sslDbPath, { recursive: true, mode: 0o700 });
  }

  logger.debug(`SSL certificate database initialized at: ${sslDbPath}`);
  return sslDbPath;
}

/**
 * Validates that OpenSSL is available
 *
 * @returns true if OpenSSL is available, false otherwise
 */
export async function isOpenSslAvailable(): Promise<boolean> {
  try {
    await execa('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses URL patterns for SSL Bump ACL rules
 *
 * Converts user-friendly URL patterns into Squid url_regex ACL patterns.
 *
 * Examples:
 * - `https://github.com/githubnext/*` → `^https://github\.com/githubnext/.*`
 * - `https://api.example.com/v1/users` → `^https://api\.example\.com/v1/users$`
 *
 * @param patterns - Array of URL patterns (can include wildcards)
 * @returns Array of regex patterns for Squid url_regex ACL
 */
export function parseUrlPatterns(patterns: string[]): string[] {
  return patterns.map(pattern => {
    // Remove trailing slash for consistency
    let p = pattern.replace(/\/$/, '');

    // Escape regex special characters except *
    p = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

    // Convert * wildcards to .* regex
    p = p.replace(/\*/g, '.*');

    // Anchor the pattern
    // If pattern ends with .* (from wildcard), don't add end anchor
    if (p.endsWith('.*')) {
      return `^${p}`;
    }
    // For exact matches, add end anchor
    return `^${p}$`;
  });
}

/**
 * Generates Squid SSL Bump configuration section
 *
 * This configuration enables SSL interception for HTTPS traffic,
 * allowing URL-based filtering for encrypted connections.
 *
 * @param caFiles - Paths to CA certificate and key
 * @param sslDbPath - Path to SSL certificate database
 * @param port - Squid listening port
 * @returns Squid configuration string for SSL Bump
 */
export function generateSslBumpConfig(
  caFiles: CaFiles,
  sslDbPath: string,
  port: number
): string {
  return `
# SSL Bump configuration for HTTPS inspection
# WARNING: This enables TLS interception - traffic is decrypted for inspection

# SSL port configuration with bump capabilities
https_port ${port} intercept ssl-bump \\
  cert=${caFiles.certPath} \\
  key=${caFiles.keyPath} \\
  generate-host-certificates=on \\
  dynamic_cert_mem_cache_size=4MB \\
  tls-default-ca=off

# SSL certificate database for dynamic certificate generation
sslcrtd_program /usr/lib/squid/security_file_certgen -s ${sslDbPath} -M 4MB

# SSL Bump steps:
# 1. Peek at SNI to get the server name
# 2. Bump (intercept) connections to allowed domains
# 3. Terminate (deny) connections to other domains

acl step1 at_step SslBump1
acl step2 at_step SslBump2
acl step3 at_step SslBump3

# Peek at ClientHello to see SNI
ssl_bump peek step1

# Stare at server certificate to validate it
ssl_bump stare step2

# Bump allowed domains to enable URL inspection
ssl_bump bump allowed_domains
ssl_bump bump allowed_domains_regex

# Terminate connections to non-allowed domains
ssl_bump terminate all
`;
}
