import { Command } from 'commander';
import { parseEnvironmentVariables, parseDomains, escapeShellArg, joinShellArgs, parseVolumeMounts } from './cli';
import { redactSecrets } from './redact-secrets';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('cli', () => {
  describe('domain parsing', () => {
    it('should split comma-separated domains correctly', () => {
      const result = parseDomains('github.com, api.github.com, npmjs.org');

      expect(result).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
    });

    it('should handle domains without spaces', () => {
      const result = parseDomains('github.com,api.github.com,npmjs.org');

      expect(result).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
    });

    it('should filter out empty domains', () => {
      const result = parseDomains('github.com,,, api.github.com,  ,npmjs.org');

      expect(result).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
    });

    it('should return empty array for whitespace-only input', () => {
      const result = parseDomains('  ,  ,  ');

      expect(result).toEqual([]);
    });

    it('should handle single domain', () => {
      const result = parseDomains('github.com');

      expect(result).toEqual(['github.com']);
    });
  });

  describe('environment variable parsing', () => {
    it('should parse KEY=VALUE format correctly', () => {
      const envVars = ['GITHUB_TOKEN=abc123', 'API_KEY=xyz789'];
      const result = parseEnvironmentVariables(envVars);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.env).toEqual({
          GITHUB_TOKEN: 'abc123',
          API_KEY: 'xyz789',
        });
      }
    });

    it('should handle empty values', () => {
      const envVars = ['EMPTY_VAR='];
      const result = parseEnvironmentVariables(envVars);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.env).toEqual({
          EMPTY_VAR: '',
        });
      }
    });

    it('should handle values with equals signs', () => {
      const envVars = ['BASE64_VAR=abc=def=ghi'];
      const result = parseEnvironmentVariables(envVars);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.env).toEqual({
          BASE64_VAR: 'abc=def=ghi',
        });
      }
    });

    it('should reject invalid format (no equals sign)', () => {
      const envVars = ['INVALID_VAR'];
      const result = parseEnvironmentVariables(envVars);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidVar).toBe('INVALID_VAR');
      }
    });

    it('should handle empty array', () => {
      const envVars: string[] = [];
      const result = parseEnvironmentVariables(envVars);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.env).toEqual({});
      }
    });

    it('should return error on first invalid entry', () => {
      const envVars = ['VALID_VAR=value', 'INVALID_VAR', 'ANOTHER_VALID=value2'];
      const result = parseEnvironmentVariables(envVars);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidVar).toBe('INVALID_VAR');
      }
    });
  });

  describe('secret redaction', () => {
    it('should redact Bearer tokens', () => {
      const command = 'curl -H "Authorization: Bearer ghp_1234567890abcdef" https://api.github.com';
      const result = redactSecrets(command);

      // The regex captures quotes too, so the closing quote gets included in \S+
      expect(result).not.toContain('ghp_1234567890abcdef');
      expect(result).toContain('***REDACTED***');
    });

    it('should redact non-Bearer Authorization headers', () => {
      const command = 'curl -H "Authorization: token123" https://api.github.com';
      const result = redactSecrets(command);

      expect(result).not.toContain('token123');
      expect(result).toContain('***REDACTED***');
    });

    it('should redact GITHUB_TOKEN environment variable', () => {
      const command = 'GITHUB_TOKEN=ghp_abc123 npx @github/copilot';
      const result = redactSecrets(command);

      expect(result).toBe('GITHUB_TOKEN=***REDACTED*** npx @github/copilot');
      expect(result).not.toContain('ghp_abc123');
    });

    it('should redact API_KEY environment variable', () => {
      const command = 'API_KEY=secret123 npm run deploy';
      const result = redactSecrets(command);

      expect(result).toBe('API_KEY=***REDACTED*** npm run deploy');
      expect(result).not.toContain('secret123');
    });

    it('should redact PASSWORD environment variable', () => {
      const command = 'DB_PASSWORD=supersecret npm start';
      const result = redactSecrets(command);

      expect(result).toBe('DB_PASSWORD=***REDACTED*** npm start');
      expect(result).not.toContain('supersecret');
    });

    it('should redact GitHub personal access tokens', () => {
      const command = 'echo ghp_1234567890abcdefghijklmnopqrstuvwxyz0123';
      const result = redactSecrets(command);

      expect(result).toBe('echo ***REDACTED***');
      expect(result).not.toContain('ghp_');
    });

    it('should redact multiple secrets in one command', () => {
      const command = 'GITHUB_TOKEN=ghp_token API_KEY=secret curl -H "Authorization: Bearer ghp_bearer"';
      const result = redactSecrets(command);

      expect(result).not.toContain('ghp_token');
      expect(result).not.toContain('secret');
      expect(result).not.toContain('ghp_bearer');
      expect(result).toContain('***REDACTED***');
    });

    it('should not redact non-secret content', () => {
      const command = 'echo "Hello World" && ls -la';
      const result = redactSecrets(command);

      expect(result).toBe(command);
    });

    it('should handle mixed case environment variables', () => {
      const command = 'github_token=abc GitHub_TOKEN=def GiThUb_ToKeN=ghi';
      const result = redactSecrets(command);

      expect(result).toBe('github_token=***REDACTED*** GitHub_TOKEN=***REDACTED*** GiThUb_ToKeN=***REDACTED***');
    });
  });

  describe('log level validation', () => {
    const validLogLevels = ['debug', 'info', 'warn', 'error'];

    it('should accept valid log levels', () => {
      validLogLevels.forEach(level => {
        expect(validLogLevels.includes(level)).toBe(true);
      });
    });

    it('should reject invalid log levels', () => {
      const invalidLevels = ['verbose', 'trace', 'silent', 'all', ''];

      invalidLevels.forEach(level => {
        expect(validLogLevels.includes(level)).toBe(false);
      });
    });
  });

  describe('Commander.js program configuration', () => {
    it('should configure required options correctly', () => {
      const program = new Command();

      program
        .name('awf')
        .description('Network firewall for agentic workflows with domain whitelisting')
        .version('0.1.0')
        .requiredOption(
          '--allow-domains <domains>',
          'Comma-separated list of allowed domains'
        )
        .option('--log-level <level>', 'Log level: debug, info, warn, error', 'info')
        .option('--keep-containers', 'Keep containers running after command exits', false)
        .argument('[args...]', 'Command and arguments to execute');

      expect(program.name()).toBe('awf');
      expect(program.description()).toBe('Network firewall for agentic workflows with domain whitelisting');
    });

    it('should have default values for optional flags', () => {
      const program = new Command();

      program
        .option('--log-level <level>', 'Log level', 'info')
        .option('--keep-containers', 'Keep containers', false)
        .option('--build-local', 'Build locally', false)
        .option('--env-all', 'Pass all env vars', false);

      // Parse empty args to get defaults
      program.parse(['node', 'awf'], { from: 'user' });
      const opts = program.opts();

      expect(opts.logLevel).toBe('info');
      expect(opts.keepContainers).toBe(false);
      expect(opts.buildLocal).toBe(false);
      expect(opts.envAll).toBe(false);
    });
  });

  describe('argument parsing with variadic args', () => {
    it('should handle multiple arguments after -- separator', () => {
      const program = new Command();
      let capturedArgs: string[] = [];

      program
        .argument('[args...]', 'Command and arguments')
        .action((args: string[]) => {
          capturedArgs = args;
        });

      program.parse(['node', 'awf', '--', 'curl', 'https://api.github.com']);

      expect(capturedArgs).toEqual(['curl', 'https://api.github.com']);
    });

    it('should handle arguments with flags after -- separator', () => {
      const program = new Command();
      let capturedArgs: string[] = [];

      program
        .argument('[args...]', 'Command and arguments')
        .action((args: string[]) => {
          capturedArgs = args;
        });

      program.parse(['node', 'awf', '--', 'curl', '-H', 'Authorization: Bearer token', 'https://api.github.com']);

      expect(capturedArgs).toEqual(['curl', '-H', 'Authorization: Bearer token', 'https://api.github.com']);
    });

    it('should handle complex command with multiple flags', () => {
      const program = new Command();
      let capturedArgs: string[] = [];

      program
        .argument('[args...]', 'Command and arguments')
        .action((args: string[]) => {
          capturedArgs = args;
        });

      program.parse(['node', 'awf', '--', 'npx', '@github/copilot', '--prompt', 'hello world', '--log-level', 'debug']);

      expect(capturedArgs).toEqual(['npx', '@github/copilot', '--prompt', 'hello world', '--log-level', 'debug']);
    });
  });

  describe('shell argument escaping', () => {
    it('should not escape simple arguments', () => {
      expect(escapeShellArg('curl')).toBe('curl');
      expect(escapeShellArg('https://api.github.com')).toBe('https://api.github.com');
      expect(escapeShellArg('/usr/bin/node')).toBe('/usr/bin/node');
      expect(escapeShellArg('--log-level=debug')).toBe('--log-level=debug');
    });

    it('should escape arguments with spaces', () => {
      expect(escapeShellArg('hello world')).toBe("'hello world'");
      expect(escapeShellArg('Authorization: Bearer token')).toBe("'Authorization: Bearer token'");
    });

    it('should escape arguments with special characters', () => {
      expect(escapeShellArg('test$var')).toBe("'test$var'");
      expect(escapeShellArg('test`cmd`')).toBe("'test`cmd`'");
      expect(escapeShellArg('test;echo')).toBe("'test;echo'");
    });

    it('should escape single quotes in arguments', () => {
      expect(escapeShellArg("it's")).toBe("'it'\\''s'");
      expect(escapeShellArg("don't")).toBe("'don'\\''t'");
    });

    it('should join multiple arguments with proper escaping', () => {
      expect(joinShellArgs(['curl', 'https://api.github.com'])).toBe('curl https://api.github.com');
      expect(joinShellArgs(['curl', '-H', 'Authorization: Bearer token', 'https://api.github.com']))
        .toBe("curl -H 'Authorization: Bearer token' https://api.github.com");
      expect(joinShellArgs(['echo', 'hello world', 'test']))
        .toBe("echo 'hello world' test");
    });
  });

  describe('work directory generation', () => {
    it('should generate unique work directories', () => {
      const dir1 = `/tmp/awf-${Date.now()}`;

      // Wait 1ms to ensure different timestamp
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      return delay(2).then(() => {
        const dir2 = `/tmp/awf-${Date.now()}`;

        expect(dir1).not.toBe(dir2);
        expect(dir1).toMatch(/^\/tmp\/awf-\d+$/);
        expect(dir2).toMatch(/^\/tmp\/awf-\d+$/);
      });
    });

    it('should use /tmp prefix', () => {
      const dir = `/tmp/awf-${Date.now()}`;

      expect(dir).toMatch(/^\/tmp\//);
    });
  });

  describe('volume mount parsing', () => {
    let testDir: string;

    beforeEach(() => {
      // Create a temporary directory for testing
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-test-'));
    });

    afterEach(() => {
      // Clean up the test directory
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should parse valid mount with read-write mode', () => {
      const mounts = [`${testDir}:/workspace:rw`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mounts).toEqual([`${testDir}:/workspace:rw`]);
      }
    });

    it('should parse valid mount with read-only mode', () => {
      const mounts = [`${testDir}:/data:ro`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mounts).toEqual([`${testDir}:/data:ro`]);
      }
    });

    it('should parse valid mount without mode (defaults to rw)', () => {
      const mounts = [`${testDir}:/app`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mounts).toEqual([`${testDir}:/app`]);
      }
    });

    it('should parse multiple valid mounts', () => {
      const subdir1 = path.join(testDir, 'dir1');
      const subdir2 = path.join(testDir, 'dir2');
      fs.mkdirSync(subdir1);
      fs.mkdirSync(subdir2);

      const mounts = [`${subdir1}:/workspace:ro`, `${subdir2}:/data:rw`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mounts).toEqual([`${subdir1}:/workspace:ro`, `${subdir2}:/data:rw`]);
      }
    });

    it('should reject mount with too few parts', () => {
      const mounts = ['/workspace'];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe('/workspace');
        expect(result.reason).toContain('host_path:container_path[:mode]');
      }
    });

    it('should reject mount with too many parts', () => {
      const mounts = [`${testDir}:/workspace:rw:extra`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe(`${testDir}:/workspace:rw:extra`);
        expect(result.reason).toContain('host_path:container_path[:mode]');
      }
    });

    it('should reject mount with empty host path', () => {
      const mounts = [':/workspace:rw'];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe(':/workspace:rw');
        expect(result.reason).toContain('Host path cannot be empty');
      }
    });

    it('should reject mount with empty container path', () => {
      const mounts = [`${testDir}::rw`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe(`${testDir}::rw`);
        expect(result.reason).toContain('Container path cannot be empty');
      }
    });

    it('should reject mount with relative host path', () => {
      const mounts = ['./relative/path:/workspace:rw'];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe('./relative/path:/workspace:rw');
        expect(result.reason).toContain('Host path must be absolute');
      }
    });

    it('should reject mount with relative container path', () => {
      const mounts = [`${testDir}:relative/path:rw`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe(`${testDir}:relative/path:rw`);
        expect(result.reason).toContain('Container path must be absolute');
      }
    });

    it('should reject mount with invalid mode', () => {
      const mounts = [`${testDir}:/workspace:invalid`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe(`${testDir}:/workspace:invalid`);
        expect(result.reason).toContain('Mount mode must be either "ro" or "rw"');
      }
    });

    it('should reject mount with non-existent host path', () => {
      const nonExistentPath = '/tmp/this-path-definitely-does-not-exist-12345';
      const mounts = [`${nonExistentPath}:/workspace:rw`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe(`${nonExistentPath}:/workspace:rw`);
        expect(result.reason).toContain('Host path does not exist');
      }
    });

    it('should handle empty array', () => {
      const mounts: string[] = [];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mounts).toEqual([]);
      }
    });

    it('should return error on first invalid entry', () => {
      const subdir = path.join(testDir, 'valid');
      fs.mkdirSync(subdir);

      const mounts = [`${subdir}:/workspace:ro`, 'invalid-mount', `${testDir}:/data:rw`];
      const result = parseVolumeMounts(mounts);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.invalidMount).toBe('invalid-mount');
      }
    });
  });
});
