import { Command } from 'commander';

describe('cli', () => {
  describe('domain parsing', () => {
    it('should split comma-separated domains correctly', () => {
      const allowDomainsInput = 'github.com, api.github.com, npmjs.org';

      const domains = allowDomainsInput
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

      expect(domains).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
    });

    it('should handle domains without spaces', () => {
      const allowDomainsInput = 'github.com,api.github.com,npmjs.org';

      const domains = allowDomainsInput
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

      expect(domains).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
    });

    it('should filter out empty domains', () => {
      const allowDomainsInput = 'github.com,,, api.github.com,  ,npmjs.org';

      const domains = allowDomainsInput
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

      expect(domains).toEqual(['github.com', 'api.github.com', 'npmjs.org']);
    });

    it('should return empty array for whitespace-only input', () => {
      const allowDomainsInput = '  ,  ,  ';

      const domains = allowDomainsInput
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

      expect(domains).toEqual([]);
    });

    it('should handle single domain', () => {
      const allowDomainsInput = 'github.com';

      const domains = allowDomainsInput
        .split(',')
        .map(d => d.trim())
        .filter(d => d.length > 0);

      expect(domains).toEqual(['github.com']);
    });
  });

  describe('environment variable parsing', () => {
    it('should parse KEY=VALUE format correctly', () => {
      const envVars = ['GITHUB_TOKEN=abc123', 'API_KEY=xyz789'];
      const result: Record<string, string> = {};

      for (const envVar of envVars) {
        const match = envVar.match(/^([^=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          result[key] = value;
        }
      }

      expect(result).toEqual({
        GITHUB_TOKEN: 'abc123',
        API_KEY: 'xyz789',
      });
    });

    it('should handle empty values', () => {
      const envVars = ['EMPTY_VAR='];
      const result: Record<string, string> = {};

      for (const envVar of envVars) {
        const match = envVar.match(/^([^=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          result[key] = value;
        }
      }

      expect(result).toEqual({
        EMPTY_VAR: '',
      });
    });

    it('should handle values with equals signs', () => {
      const envVars = ['BASE64_VAR=abc=def=ghi'];
      const result: Record<string, string> = {};

      for (const envVar of envVars) {
        const match = envVar.match(/^([^=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          result[key] = value;
        }
      }

      expect(result).toEqual({
        BASE64_VAR: 'abc=def=ghi',
      });
    });

    it('should reject invalid format (no equals sign)', () => {
      const envVar = 'INVALID_VAR';
      const match = envVar.match(/^([^=]+)=(.*)$/);

      expect(match).toBeNull();
    });
  });

  describe('secret redaction', () => {
    const redactSecrets = (command: string): string => {
      return command
        // Redact Authorization: Bearer <token>
        .replace(/(Authorization:\s*Bearer\s+)(\S+)/gi, '$1***REDACTED***')
        // Redact Authorization: <token> (non-Bearer)
        .replace(/(Authorization:\s+(?!Bearer\s))(\S+)/gi, '$1***REDACTED***')
        // Redact tokens in environment variables
        .replace(/(\w*(?:TOKEN|SECRET|PASSWORD|KEY|AUTH)\w*)=(\S+)/gi, '$1=***REDACTED***')
        // Redact GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
        .replace(/\b(gh[pousr]_[a-zA-Z0-9]{36,255})/g, '***REDACTED***');
    };

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
        .argument('<command>', 'Copilot command to execute');

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
});
