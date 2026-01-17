import { parseUrlPatterns, secureWipeFile, cleanupSslBumpFiles } from './ssl-bump';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SSL Bump', () => {
  describe('parseUrlPatterns', () => {
    it('should escape regex special characters except wildcards', () => {
      const patterns = parseUrlPatterns(['https://github.com/user']);
      expect(patterns).toEqual(['^https://github\\.com/user$']);
    });

    it('should convert * wildcard to .* regex', () => {
      const patterns = parseUrlPatterns(['https://github.com/githubnext/*']);
      expect(patterns).toEqual(['^https://github\\.com/githubnext/.*']);
    });

    it('should handle multiple wildcards', () => {
      const patterns = parseUrlPatterns(['https://api-*.example.com/*']);
      expect(patterns).toEqual(['^https://api-.*\\.example\\.com/.*']);
    });

    it('should remove trailing slash for consistency', () => {
      const patterns = parseUrlPatterns(['https://github.com/']);
      expect(patterns).toEqual(['^https://github\\.com$']);
    });

    it('should handle exact match patterns', () => {
      const patterns = parseUrlPatterns(['https://api.example.com/v1/users']);
      expect(patterns).toEqual(['^https://api\\.example\\.com/v1/users$']);
    });

    it('should handle query parameters', () => {
      const patterns = parseUrlPatterns(['https://api.example.com/v1?key=value']);
      expect(patterns).toEqual(['^https://api\\.example\\.com/v1\\?key=value$']);
    });

    it('should escape dots in domain names', () => {
      const patterns = parseUrlPatterns(['https://sub.domain.example.com/path']);
      expect(patterns).toEqual(['^https://sub\\.domain\\.example\\.com/path$']);
    });

    it('should handle multiple patterns', () => {
      const patterns = parseUrlPatterns([
        'https://github.com/githubnext/*',
        'https://api.example.com/v1/*',
      ]);
      expect(patterns).toHaveLength(2);
      expect(patterns[0]).toBe('^https://github\\.com/githubnext/.*');
      expect(patterns[1]).toBe('^https://api\\.example\\.com/v1/.*');
    });

    it('should handle empty array', () => {
      const patterns = parseUrlPatterns([]);
      expect(patterns).toEqual([]);
    });

    it('should anchor patterns correctly for exact matches', () => {
      const patterns = parseUrlPatterns(['https://github.com/exact']);
      // Should have both start and end anchors for exact matches
      expect(patterns[0]).toBe('^https://github\\.com/exact$');
    });

    it('should not add end anchor for wildcard patterns', () => {
      const patterns = parseUrlPatterns(['https://github.com/*']);
      // Should only have start anchor for patterns ending with .*
      expect(patterns[0]).toBe('^https://github\\.com/.*');
      expect(patterns[0]).not.toContain('$');
    });
  });

  describe('secureWipeFile', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-bump-test-'));
    });

    afterEach(() => {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should delete file after secure wipe', async () => {
      const testFile = path.join(tempDir, 'test-key.pem');
      fs.writeFileSync(testFile, 'sensitive-private-key-data');

      expect(fs.existsSync(testFile)).toBe(true);

      await secureWipeFile(testFile);

      expect(fs.existsSync(testFile)).toBe(false);
    });

    it('should handle non-existent file gracefully', async () => {
      const nonExistentFile = path.join(tempDir, 'does-not-exist.pem');

      // Should not throw
      await expect(secureWipeFile(nonExistentFile)).resolves.not.toThrow();
    });

    it('should handle empty file', async () => {
      const emptyFile = path.join(tempDir, 'empty-file.pem');
      fs.writeFileSync(emptyFile, '');

      expect(fs.existsSync(emptyFile)).toBe(true);

      await secureWipeFile(emptyFile);

      expect(fs.existsSync(emptyFile)).toBe(false);
    });

    it('should wipe file with content of various sizes', async () => {
      // Test with a key-sized file (typical RSA 2048 private key is ~1.6KB)
      const testFile = path.join(tempDir, 'sized-key.pem');
      const keyContent = '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(1600) + '\n-----END PRIVATE KEY-----';
      fs.writeFileSync(testFile, keyContent);

      expect(fs.existsSync(testFile)).toBe(true);

      await secureWipeFile(testFile);

      expect(fs.existsSync(testFile)).toBe(false);
    });
  });

  describe('cleanupSslBumpFiles', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-bump-cleanup-test-'));
    });

    afterEach(() => {
      // Clean up temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should clean up SSL files when present', async () => {
      // Create SSL directory structure
      const sslDir = path.join(tempDir, 'ssl');
      fs.mkdirSync(sslDir, { recursive: true });
      fs.writeFileSync(path.join(sslDir, 'ca-key.pem'), 'private-key-content');
      fs.writeFileSync(path.join(sslDir, 'ca-cert.pem'), 'certificate-content');
      fs.writeFileSync(path.join(sslDir, 'ca-cert.der'), 'der-content');

      // Create SSL database directory
      const sslDbDir = path.join(tempDir, 'ssl_db');
      fs.mkdirSync(sslDbDir, { recursive: true });
      fs.writeFileSync(path.join(sslDbDir, 'index.txt'), '');

      await cleanupSslBumpFiles(tempDir);

      // All SSL files should be removed
      expect(fs.existsSync(path.join(sslDir, 'ca-key.pem'))).toBe(false);
      expect(fs.existsSync(path.join(sslDir, 'ca-cert.pem'))).toBe(false);
      expect(fs.existsSync(path.join(sslDir, 'ca-cert.der'))).toBe(false);
      // SSL directory should be removed if empty
      expect(fs.existsSync(sslDir)).toBe(false);
      // SSL database directory should be removed
      expect(fs.existsSync(sslDbDir)).toBe(false);
    });

    it('should handle missing SSL files gracefully', async () => {
      // No SSL files exist
      await expect(cleanupSslBumpFiles(tempDir)).resolves.not.toThrow();
    });

    it('should handle partial SSL file cleanup', async () => {
      // Create only the key file
      const sslDir = path.join(tempDir, 'ssl');
      fs.mkdirSync(sslDir, { recursive: true });
      fs.writeFileSync(path.join(sslDir, 'ca-key.pem'), 'private-key-content');

      await cleanupSslBumpFiles(tempDir);

      expect(fs.existsSync(path.join(sslDir, 'ca-key.pem'))).toBe(false);
      expect(fs.existsSync(sslDir)).toBe(false);
    });
  });
});
