import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseUrlPatterns, generateSessionCa, initSslDb, isOpenSslAvailable } from './ssl-bump';

// Pattern constant for the safer URL character class (matches the implementation)
const URL_CHAR_PATTERN = '[^\\s]*';

// Mock execa for testing OpenSSL operations
jest.mock('execa', () => {
  const mockFn = jest.fn();
  return {
    __esModule: true,
    default: mockFn,
  };
});

// Get the mocked execa after jest.mock hoisting
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockExeca = require('execa').default as jest.Mock;

// Default mock implementation for execa
beforeEach(() => {
  mockExeca.mockReset();
  mockExeca.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'openssl') {
      if (args[0] === 'version') {
        return Promise.resolve({ stdout: 'OpenSSL 3.0.0 7 Sep 2021' });
      }
      if (args[0] === 'req') {
        // Mock certificate generation - create the files
        const keyoutIndex = args.indexOf('-keyout');
        const outIndex = args.indexOf('-out');
        if (keyoutIndex !== -1 && outIndex !== -1) {
          const keyPath = args[keyoutIndex + 1];
          const certPath = args[outIndex + 1];
          // Create mock files
          fs.writeFileSync(keyPath, 'MOCK PRIVATE KEY');
          fs.writeFileSync(certPath, 'MOCK CERTIFICATE');
        }
        return Promise.resolve({ stdout: '' });
      }
      if (args[0] === 'x509') {
        // Mock DER conversion
        const outIndex = args.indexOf('-out');
        if (outIndex !== -1) {
          const derPath = args[outIndex + 1];
          fs.writeFileSync(derPath, 'MOCK DER CERTIFICATE');
        }
        return Promise.resolve({ stdout: '' });
      }
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`));
  });
});

describe('SSL Bump', () => {
  describe('parseUrlPatterns', () => {
    it('should escape regex special characters except wildcards', () => {
      const patterns = parseUrlPatterns(['https://github.com/user']);
      expect(patterns).toEqual(['^https://github\\.com/user$']);
    });

    it('should convert * wildcard to safe regex pattern', () => {
      const patterns = parseUrlPatterns(['https://github.com/myorg/*']);
      expect(patterns).toEqual([`^https://github\\.com/myorg/${URL_CHAR_PATTERN}`]);
    });

    it('should handle multiple wildcards', () => {
      const patterns = parseUrlPatterns(['https://api-*.example.com/*']);
      expect(patterns).toEqual([`^https://api-${URL_CHAR_PATTERN}\\.example\\.com/${URL_CHAR_PATTERN}`]);
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
        'https://github.com/myorg/*',
        'https://api.example.com/v1/*',
      ]);
      expect(patterns).toHaveLength(2);
      expect(patterns[0]).toBe(`^https://github\\.com/myorg/${URL_CHAR_PATTERN}`);
      expect(patterns[1]).toBe(`^https://api\\.example\\.com/v1/${URL_CHAR_PATTERN}`);
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
      // Should only have start anchor for patterns ending with the URL char pattern
      expect(patterns[0]).toBe(`^https://github\\.com/${URL_CHAR_PATTERN}`);
      expect(patterns[0]).not.toContain('$');
    });
  });

  describe('generateSessionCa', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-bump-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create ssl directory and CA files', async () => {
      const result = await generateSessionCa({ workDir: tempDir });

      // Check paths are returned
      expect(result.certPath).toBe(path.join(tempDir, 'ssl', 'ca-cert.pem'));
      expect(result.keyPath).toBe(path.join(tempDir, 'ssl', 'ca-key.pem'));
      expect(result.derPath).toBe(path.join(tempDir, 'ssl', 'ca-cert.der'));

      // Check files were created (via mocks)
      expect(fs.existsSync(result.certPath)).toBe(true);
      expect(fs.existsSync(result.keyPath)).toBe(true);
      expect(fs.existsSync(result.derPath)).toBe(true);
    });

    it('should use custom common name and validity days', async () => {
      const result = await generateSessionCa({
        workDir: tempDir,
        commonName: 'Custom CA',
        validityDays: 7,
      });

      // Just verify it completes without error
      expect(result.certPath).toContain('ca-cert.pem');
    });

    it('should create ssl directory if it does not exist', async () => {
      const sslDir = path.join(tempDir, 'ssl');
      expect(fs.existsSync(sslDir)).toBe(false);

      await generateSessionCa({ workDir: tempDir });

      expect(fs.existsSync(sslDir)).toBe(true);
    });

    it('should handle existing ssl directory', async () => {
      const sslDir = path.join(tempDir, 'ssl');
      fs.mkdirSync(sslDir, { recursive: true });

      const result = await generateSessionCa({ workDir: tempDir });

      expect(result.certPath).toContain('ca-cert.pem');
    });

    it('should throw error when OpenSSL command fails', async () => {
      mockExeca.mockImplementationOnce(() => {
        return Promise.reject(new Error('OpenSSL not found'));
      });

      await expect(generateSessionCa({ workDir: tempDir })).rejects.toThrow(
        'Failed to generate SSL Bump CA: OpenSSL not found'
      );
    });
  });

  describe('initSslDb', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-db-test-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create ssl_db directory structure', async () => {
      const sslDbPath = await initSslDb(tempDir);

      expect(sslDbPath).toBe(path.join(tempDir, 'ssl_db'));
      expect(fs.existsSync(path.join(sslDbPath, 'certs'))).toBe(true);
      expect(fs.existsSync(path.join(sslDbPath, 'index.txt'))).toBe(true);
      expect(fs.existsSync(path.join(sslDbPath, 'size'))).toBe(true);
    });

    it('should create empty index.txt file', async () => {
      const sslDbPath = await initSslDb(tempDir);

      const indexContent = fs.readFileSync(path.join(sslDbPath, 'index.txt'), 'utf-8');
      expect(indexContent).toBe('');
    });

    it('should create size file with 0', async () => {
      const sslDbPath = await initSslDb(tempDir);

      const sizeContent = fs.readFileSync(path.join(sslDbPath, 'size'), 'utf-8');
      expect(sizeContent).toBe('0\n');
    });

    it('should not overwrite existing files', async () => {
      // First initialization
      const sslDbPath = await initSslDb(tempDir);

      // Write custom content
      fs.writeFileSync(path.join(sslDbPath, 'index.txt'), 'custom content');

      // Second initialization
      await initSslDb(tempDir);

      // Check content is preserved
      const indexContent = fs.readFileSync(path.join(sslDbPath, 'index.txt'), 'utf-8');
      expect(indexContent).toBe('custom content');
    });

    it('should handle existing ssl_db directory', async () => {
      const sslDbPath = path.join(tempDir, 'ssl_db');
      fs.mkdirSync(sslDbPath, { recursive: true });

      const result = await initSslDb(tempDir);

      expect(result).toBe(sslDbPath);
    });
  });

  describe('isOpenSslAvailable', () => {
    it('should return true when OpenSSL is available', async () => {
      const result = await isOpenSslAvailable();
      expect(result).toBe(true);
    });

    it('should return false when OpenSSL command fails', async () => {
      mockExeca.mockImplementationOnce(() => {
        return Promise.reject(new Error('command not found'));
      });

      const result = await isOpenSslAvailable();
      expect(result).toBe(false);
    });
  });
});
