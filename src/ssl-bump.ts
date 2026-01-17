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
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, '', { mode: 0o600 });
  }

  // Create size file (tracks current DB size, starts at 0)
  if (!fs.existsSync(sizePath)) {
    fs.writeFileSync(sizePath, '0\n', { mode: 0o600 });
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
 * Securely wipes a file by overwriting its contents with random data
 * before deletion. This provides defense-in-depth against key recovery
 * attacks if the underlying storage is compromised.
 *
 * Security notes:
 * - Overwrites with cryptographically random data (3 passes)
 * - Syncs to disk to ensure overwrites are flushed
 * - File is deleted after wiping
 * - On failure, attempts to delete anyway (best-effort cleanup)
 *
 * @param filePath - Path to the file to securely wipe
 * @throws Error if file operations fail (after attempting cleanup)
 */
export async function secureWipeFile(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    logger.debug(`File not found for secure wipe: ${filePath}`);
    return;
  }

  try {
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    if (fileSize === 0) {
      // Empty file, just delete it
      fs.unlinkSync(filePath);
      logger.debug(`Deleted empty file: ${filePath}`);
      return;
    }

    // Open file for writing (not appending)
    const fd = fs.openSync(filePath, 'w');

    try {
      // Generate random data for overwriting
      const { randomBytes } = await import('crypto');

      // Perform 3 overwrite passes with random data
      // This provides defense-in-depth against simple recovery attempts
      for (let pass = 0; pass < 3; pass++) {
        const randomData = randomBytes(fileSize);
        fs.writeSync(fd, randomData, 0, fileSize, 0);
        fs.fsyncSync(fd); // Force flush to disk
      }

      logger.debug(`Securely wiped file (${fileSize} bytes, 3 passes): ${filePath}`);
    } finally {
      fs.closeSync(fd);
    }

    // Delete the file after wiping
    fs.unlinkSync(filePath);
    logger.debug(`Deleted file after secure wipe: ${filePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Secure wipe failed for ${filePath}: ${message}`);

    // Best-effort cleanup: try to delete even if wipe failed
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.debug(`Deleted file after failed secure wipe: ${filePath}`);
      }
    } catch {
      // Ignore deletion errors - we tried our best
    }
  }
}

/**
 * Cleans up SSL Bump files with secure key wiping
 *
 * This function should be called during cleanup to ensure the CA private key
 * is securely wiped before the working directory is deleted. This provides
 * defense-in-depth against key recovery in case of:
 * - Container escape scenarios
 * - Host filesystem compromise
 * - Incomplete cleanup due to crashes
 *
 * @param workDir - Working directory containing SSL files
 */
export async function cleanupSslBumpFiles(workDir: string): Promise<void> {
  const sslDir = path.join(workDir, 'ssl');
  const keyPath = path.join(sslDir, 'ca-key.pem');

  // Securely wipe the private key first (most sensitive)
  if (fs.existsSync(keyPath)) {
    logger.debug('Securely wiping SSL Bump CA private key...');
    await secureWipeFile(keyPath);
  }

  // The certificate and DER files are not sensitive (public),
  // but we can delete them normally
  const certPath = path.join(sslDir, 'ca-cert.pem');
  const derPath = path.join(sslDir, 'ca-cert.der');

  for (const filePath of [certPath, derPath]) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.debug(`Deleted SSL file: ${filePath}`);
      } catch (error) {
        logger.debug(`Failed to delete SSL file ${filePath}:`, error);
      }
    }
  }

  // Clean up the SSL database directory
  const sslDbPath = path.join(workDir, 'ssl_db');
  if (fs.existsSync(sslDbPath)) {
    try {
      fs.rmSync(sslDbPath, { recursive: true, force: true });
      logger.debug(`Deleted SSL database directory: ${sslDbPath}`);
    } catch (error) {
      logger.debug(`Failed to delete SSL database ${sslDbPath}:`, error);
    }
  }

  // Remove the ssl directory if it's empty
  if (fs.existsSync(sslDir)) {
    try {
      const remaining = fs.readdirSync(sslDir);
      if (remaining.length === 0) {
        fs.rmdirSync(sslDir);
        logger.debug(`Removed empty SSL directory: ${sslDir}`);
      }
    } catch (error) {
      logger.debug(`Failed to clean up SSL directory ${sslDir}:`, error);
    }
  }

  logger.debug('SSL Bump cleanup completed');
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

    // Preserve .* patterns by using a placeholder before escaping
    const WILDCARD_PLACEHOLDER = '\x00WILDCARD\x00';
    p = p.replace(/\.\*/g, WILDCARD_PLACEHOLDER);

    // Escape regex special characters except *
    p = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

    // Convert * wildcards to .* regex
    p = p.replace(/\*/g, '.*');

    // Restore .* patterns from placeholder
    p = p.replace(new RegExp(WILDCARD_PLACEHOLDER, 'g'), '.*');

    // Anchor the pattern
    // If pattern ends with .* (from wildcard), don't add end anchor
    if (p.endsWith('.*')) {
      return `^${p}`;
    }
    // For exact matches, add end anchor
    return `^${p}$`;
  });
}
