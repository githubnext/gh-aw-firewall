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
    // Security: commonName defaults to 'AWF Session CA' and is only configurable
    // via SslBumpConfig interface (not direct user input). The value is used in
    // the certificate subject which is not shell-interpreted by OpenSSL.
    await execa('openssl', [
      'req',
      '-new',
      '-newkey', 'rsa:2048',
      '-days', validityDays.toString(),
      '-nodes', // No password on private key
      '-x509',
      // eslint-disable-next-line local/no-unsafe-execa
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
 * certificates for SSL Bump mode. The database structure expected by Squid is:
 * - ssl_db/certs/ - Directory for storing generated certificates
 * - ssl_db/index.txt - Index file for certificate lookups
 * - ssl_db/size - File tracking current database size
 *
 * NOTE: We create this structure on the host because security_file_certgen
 * (Squid's DB initialization tool) requires the directory to NOT exist when
 * it runs. Since Docker volume mounts create the directory, we need to
 * pre-populate the structure ourselves.
 *
 * @param workDir - Working directory
 * @returns Path to the SSL database directory
 */
export async function initSslDb(workDir: string): Promise<string> {
  const sslDbPath = path.join(workDir, 'ssl_db');
  const certsPath = path.join(sslDbPath, 'certs');
  const indexPath = path.join(sslDbPath, 'index.txt');
  const sizePath = path.join(sslDbPath, 'size');

  // Create the database structure
  if (!fs.existsSync(sslDbPath)) {
    fs.mkdirSync(sslDbPath, { recursive: true, mode: 0o700 });
  }

  // Create certs subdirectory
  if (!fs.existsSync(certsPath)) {
    fs.mkdirSync(certsPath, { mode: 0o700 });
  }

  // Create index.txt (empty file for certificate index)
  // Use 'wx' flag (O_WRONLY | O_CREAT | O_EXCL) for atomic create-if-not-exists,
  // avoiding TOCTOU race between existsSync and writeFileSync
  try {
    fs.writeFileSync(indexPath, '', { flag: 'wx', mode: 0o600 });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }

  // Create size file (tracks current DB size, starts at 0)
  // Same atomic pattern to avoid TOCTOU race condition
  try {
    fs.writeFileSync(sizePath, '0\n', { flag: 'wx', mode: 0o600 });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
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
 * Regex pattern for matching URL path characters.
 * Uses character class instead of .* to prevent catastrophic backtracking (ReDoS).
 * Matches any non-whitespace character, which is appropriate for URL paths.
 */
const URL_CHAR_PATTERN = '[^\\s]*';

/**
 * Parses URL patterns for SSL Bump ACL rules
 *
 * Converts user-friendly URL patterns into Squid url_regex ACL patterns.
 *
 * Examples:
 * - `https://github.com/myorg/*` → `^https://github\.com/myorg/[^\s]*`
 * - `https://api.example.com/v1/users` → `^https://api\.example\.com/v1/users$`
 *
 * @param patterns - Array of URL patterns (can include wildcards)
 * @returns Array of regex patterns for Squid url_regex ACL
 */
export function parseUrlPatterns(patterns: string[]): string[] {
  return patterns.map(pattern => {
    // Remove trailing slash for consistency
    let p = pattern.replace(/\/$/, '');

    // Preserve existing .* patterns by using a placeholder before escaping
    const WILDCARD_PLACEHOLDER = '\x00WILDCARD\x00';
    p = p.replace(/\.\*/g, WILDCARD_PLACEHOLDER);

    // Escape regex special characters except *
    p = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

    // Convert * wildcards to safe pattern (prevents ReDoS)
    p = p.replace(/\*/g, URL_CHAR_PATTERN);

    // Restore preserved patterns from placeholder
    p = p.replace(new RegExp(WILDCARD_PLACEHOLDER, 'g'), URL_CHAR_PATTERN);

    // Anchor the pattern
    // If pattern ends with the URL char pattern (from wildcard), don't add end anchor
    if (p.endsWith(URL_CHAR_PATTERN)) {
      return `^${p}`;
    }
    // For exact matches, add end anchor
    return `^${p}$`;
  });
}
