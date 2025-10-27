import { generateDockerCompose, escapeBashCommand } from './docker-manager';
import { WrapperConfig } from './types';

describe('docker-manager', () => {
  describe('subnetsOverlap', () => {
    // Import private function for testing by extracting logic
    const subnetsOverlap = (subnet1: string, subnet2: string): boolean => {
      const [ip1, cidr1] = subnet1.split('/');
      const [ip2, cidr2] = subnet2.split('/');

      const ipToNumber = (ip: string): number => {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
      };

      const getNetworkRange = (ip: string, cidr: string): [number, number] => {
        const ipNum = ipToNumber(ip);
        const maskBits = parseInt(cidr, 10);
        const mask = (0xffffffff << (32 - maskBits)) >>> 0;
        const networkAddr = (ipNum & mask) >>> 0;
        const broadcastAddr = (networkAddr | ~mask) >>> 0;
        return [networkAddr, broadcastAddr];
      };

      const [start1, end1] = getNetworkRange(ip1, cidr1);
      const [start2, end2] = getNetworkRange(ip2, cidr2);

      return (start1 <= end2 && end1 >= start2);
    };

    it('should detect overlapping subnets with same CIDR', () => {
      expect(subnetsOverlap('172.30.0.0/24', '172.30.0.0/24')).toBe(true);
    });

    it('should detect non-overlapping subnets', () => {
      expect(subnetsOverlap('172.30.0.0/24', '172.31.0.0/24')).toBe(false);
      expect(subnetsOverlap('192.168.1.0/24', '192.168.2.0/24')).toBe(false);
    });

    it('should detect when smaller subnet is inside larger subnet', () => {
      expect(subnetsOverlap('172.16.0.0/16', '172.16.5.0/24')).toBe(true);
      expect(subnetsOverlap('172.16.5.0/24', '172.16.0.0/16')).toBe(true);
    });

    it('should detect partial overlap', () => {
      expect(subnetsOverlap('172.30.0.0/23', '172.30.1.0/24')).toBe(true);
    });

    it('should handle Docker default bridge network', () => {
      expect(subnetsOverlap('172.17.0.0/16', '172.17.5.0/24')).toBe(true);
      expect(subnetsOverlap('172.17.0.0/16', '172.18.0.0/16')).toBe(false);
    });

    it('should handle /32 (single host) networks', () => {
      expect(subnetsOverlap('192.168.1.1/32', '192.168.1.1/32')).toBe(true);
      expect(subnetsOverlap('192.168.1.1/32', '192.168.1.2/32')).toBe(false);
    });
  });

  describe('generateDockerCompose', () => {
    const mockConfig: WrapperConfig = {
      allowedDomains: ['github.com', 'npmjs.org'],
      copilotCommand: 'echo "test"',
      logLevel: 'info',
      keepContainers: false,
      workDir: '/tmp/awf-test',
      buildLocal: false,
      imageRegistry: 'ghcr.io/githubnext/gh-aw-firewall',
      imageTag: 'latest',
    };

    const mockNetworkConfig = {
      subnet: '172.30.0.0/24',
      squidIp: '172.30.0.10',
      copilotIp: '172.30.0.20',
    };

    it('should generate docker-compose config with GHCR images by default', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].image).toBe('ghcr.io/githubnext/gh-aw-firewall/squid:latest');
      expect(result.services.copilot.image).toBe('ghcr.io/githubnext/gh-aw-firewall/copilot:latest');
      expect(result.services['squid-proxy'].build).toBeUndefined();
      expect(result.services.copilot.build).toBeUndefined();
    });

    it('should use local build when buildLocal is true', () => {
      const localConfig = { ...mockConfig, buildLocal: true };
      const result = generateDockerCompose(localConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].build).toBeDefined();
      expect(result.services.copilot.build).toBeDefined();
      expect(result.services['squid-proxy'].image).toBeUndefined();
      expect(result.services.copilot.image).toBeUndefined();
    });

    it('should use custom registry and tag', () => {
      const customConfig = {
        ...mockConfig,
        imageRegistry: 'docker.io/myrepo',
        imageTag: 'v1.0.0',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].image).toBe('docker.io/myrepo/squid:v1.0.0');
      expect(result.services.copilot.image).toBe('docker.io/myrepo/copilot:v1.0.0');
    });

    it('should configure network with correct IPs', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);

      expect(result.networks['awf-net'].external).toBe(true);

      const squidNetworks = result.services['squid-proxy'].networks as { [key: string]: { ipv4_address?: string } };
      expect(squidNetworks['awf-net'].ipv4_address).toBe('172.30.0.10');

      const copilotNetworks = result.services.copilot.networks as { [key: string]: { ipv4_address?: string } };
      expect(copilotNetworks['awf-net'].ipv4_address).toBe('172.30.0.20');
    });

    it('should configure squid container correctly', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const squid = result.services['squid-proxy'];

      expect(squid.container_name).toBe('awf-squid');
      expect(squid.volumes).toContain('/tmp/awf-test/squid.conf:/etc/squid/squid.conf:ro');
      expect(squid.volumes).toContain('/tmp/awf-test/squid-logs:/var/log/squid:rw');
      expect(squid.healthcheck).toBeDefined();
      expect(squid.ports).toContain('3128:3128');
    });

    it('should configure copilot container with proxy settings', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const copilot = result.services.copilot;
      const env = copilot.environment as Record<string, string>;

      expect(env.HTTP_PROXY).toBe('http://172.30.0.10:3128');
      expect(env.HTTPS_PROXY).toBe('http://172.30.0.10:3128');
      expect(env.SQUID_PROXY_HOST).toBe('squid-proxy');
      expect(env.SQUID_PROXY_PORT).toBe('3128');
    });

    it('should mount required volumes in copilot container', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const copilot = result.services.copilot;
      const volumes = copilot.volumes as string[];

      expect(volumes).toContain('/:/host:rw');
      expect(volumes).toContain('/tmp:/tmp:rw');
      expect(volumes).toContain('/var/run/docker.sock:/var/run/docker.sock:rw');
      expect(volumes.some((v: string) => v.includes('copilot-logs'))).toBe(true);
    });

    it('should set copilot to depend on healthy squid', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const copilot = result.services.copilot;
      const depends = copilot.depends_on as { [key: string]: { condition: string } };

      expect(depends['squid-proxy'].condition).toBe('service_healthy');
    });

    it('should add NET_ADMIN capability to copilot', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const copilot = result.services.copilot;

      expect(copilot.cap_add).toContain('NET_ADMIN');
    });

    it('should disable TTY to prevent ANSI escape sequences', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const copilot = result.services.copilot;

      expect(copilot.tty).toBe(false);
    });

    it('should escape dollar signs in commands for docker-compose', () => {
      const configWithVars = {
        ...mockConfig,
        copilotCommand: 'echo $HOME && echo ${USER}',
      };
      const result = generateDockerCompose(configWithVars, mockNetworkConfig);
      const copilot = result.services.copilot;

      // Docker compose requires $$ to represent a literal $
      // Ampersands are also escaped to prevent unintended backgrounding
      expect(copilot.command).toEqual(['/bin/bash', '-c', 'echo $$HOME \\&\\& echo $${USER}']);
    });

    it('should pass through GITHUB_TOKEN when present in environment', () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_testtoken123';

      try {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const env = result.services.copilot.environment as Record<string, string>;
        expect(env.GITHUB_TOKEN).toBe('ghp_testtoken123');
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_TOKEN = originalEnv;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });

    it('should not pass through GITHUB_TOKEN when not in environment', () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;

      try {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const env = result.services.copilot.environment as Record<string, string>;
        expect(env.GITHUB_TOKEN).toBeUndefined();
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_TOKEN = originalEnv;
        }
      }
    });

    it('should add additional environment variables from config', () => {
      const configWithEnv = {
        ...mockConfig,
        additionalEnv: {
          CUSTOM_VAR: 'custom_value',
          ANOTHER_VAR: 'another_value',
        },
      };
      const result = generateDockerCompose(configWithEnv, mockNetworkConfig);
      const copilot = result.services.copilot;
      const env = copilot.environment as Record<string, string>;

      expect(env.CUSTOM_VAR).toBe('custom_value');
      expect(env.ANOTHER_VAR).toBe('another_value');
    });

    it('should exclude system variables when envAll is enabled', () => {
      const originalPath = process.env.PATH;
      const originalUser = process.env.USER;
      process.env.CUSTOM_HOST_VAR = 'test_value';

      try {
        const configWithEnvAll = { ...mockConfig, envAll: true };
        const result = generateDockerCompose(configWithEnvAll, mockNetworkConfig);
        const copilot = result.services.copilot;
        const env = copilot.environment as Record<string, string>;

        // Should NOT pass through excluded vars
        expect(env.PATH).not.toBe(originalPath);
        expect(env.PATH).toBe('/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin');

        // Should pass through non-excluded vars
        expect(env.CUSTOM_HOST_VAR).toBe('test_value');
      } finally {
        delete process.env.CUSTOM_HOST_VAR;
      }
    });

    it('should configure DNS to use Google DNS', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const copilot = result.services.copilot;

      expect(copilot.dns).toEqual(['8.8.8.8', '8.8.4.4']);
      expect(copilot.dns_search).toEqual([]);
    });

    it('should override environment variables with additionalEnv', () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'original_token';

      try {
        const configWithOverride = {
          ...mockConfig,
          additionalEnv: {
            GITHUB_TOKEN: 'overridden_token',
          },
        };
        const result = generateDockerCompose(configWithOverride, mockNetworkConfig);
        const env = result.services.copilot.environment as Record<string, string>;

        // additionalEnv should win
        expect(env.GITHUB_TOKEN).toBe('overridden_token');
      } finally {
        if (originalEnv !== undefined) {
          process.env.GITHUB_TOKEN = originalEnv;
        } else {
          delete process.env.GITHUB_TOKEN;
        }
      }
    });
  });

  describe('escapeBashCommand', () => {
    describe('parentheses escaping (gh-aw PR #2493)', () => {
      it('should escape parentheses in single shell tool name', () => {
        const input = "npx @github/copilot --allow-tool 'shell(cat)' --prompt 'test'";
        const escaped = escapeBashCommand(input);

        // Parentheses should be escaped to prevent subshell interpretation
        expect(escaped).toContain('shell\\(cat\\)');
        // Single quotes should be preserved
        expect(escaped).toContain("'");
      });

      it('should escape parentheses in multiple shell tool names', () => {
        const input = "--allow-tool 'shell(cat)' --allow-tool 'shell(grep)' --allow-tool 'shell(date)'";
        const escaped = escapeBashCommand(input);

        // All parentheses should be escaped
        expect(escaped).toContain('shell\\(cat\\)');
        expect(escaped).toContain('shell\\(grep\\)');
        expect(escaped).toContain('shell\\(date\\)');
      });

      it('should escape parentheses outside of quotes', () => {
        const input = "echo (test) value";
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('\\(test\\)');
      });
    });

    describe('dollar sign escaping (Docker Compose)', () => {
      it('should double dollar signs for Docker Compose variable interpolation', () => {
        const input = 'echo $HOME';
        const escaped = escapeBashCommand(input);

        // Single $ should become $$ for docker-compose
        expect(escaped).toBe('echo $$HOME');
      });

      it('should handle multiple dollar signs', () => {
        const input = 'echo $HOME $USER $PATH';
        const escaped = escapeBashCommand(input);

        expect(escaped).toBe('echo $$HOME $$USER $$PATH');
      });

      it('should handle dollar signs in complex commands', () => {
        const input = "echo \"What's in $(pwd)?\"";
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('$$');
      });
    });

    describe('other special characters', () => {
      it('should escape backticks', () => {
        const input = 'echo `date`';
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('\\`');
      });

      it('should escape semicolons', () => {
        const input = 'echo hello; echo world';
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('\\;');
      });

      it('should escape ampersands', () => {
        const input = 'echo hello & echo world';
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('\\&');
      });

      it('should escape pipes', () => {
        const input = 'echo hello | grep hello';
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('\\|');
      });

      it('should escape redirects', () => {
        const input = 'echo hello > file.txt';
        const escaped = escapeBashCommand(input);

        expect(escaped).toContain('\\>');
      });
    });

    describe('real-world Copilot commands', () => {
      it('should handle full Copilot CLI command from gh-aw PR #2493', () => {
        const input = `npx @github/copilot@0.0.351 --allow-tool github --allow-tool safeoutputs --allow-tool 'shell(cat)' --allow-tool 'shell(date)' --allow-tool 'shell(echo)' --allow-tool 'shell(grep)' --prompt "test prompt"`;
        const escaped = escapeBashCommand(input);

        // Should escape parentheses
        expect(escaped).toContain('\\(');
        expect(escaped).toContain('\\)');

        // Should preserve overall command structure
        expect(escaped).toContain('npx');
        expect(escaped).toContain('@github/copilot');
        expect(escaped).toContain('--allow-tool');
      });

      it('should handle Copilot command with complex prompt', () => {
        const input = `npx @github/copilot --allow-tool 'shell(cat)' --prompt "What's in $(pwd)?"`;
        const escaped = escapeBashCommand(input);

        // Should escape parentheses in tool name
        expect(escaped).toContain('shell\\(cat\\)');
        // Should escape dollar signs
        expect(escaped).toContain('$$');
      });
    });

    describe('edge cases', () => {
      it('should handle empty string', () => {
        const input = '';
        const escaped = escapeBashCommand(input);

        expect(escaped).toBe('');
      });

      it('should handle command with no special characters', () => {
        const input = 'echo hello world';
        const escaped = escapeBashCommand(input);

        // Should remain unchanged (no special chars to escape)
        expect(escaped).toBe('echo hello world');
      });

      it('should handle nested quotes', () => {
        const input = `echo "He said 'hello'"`;
        const escaped = escapeBashCommand(input);

        // Should preserve quote structure
        expect(escaped).toContain('"');
        expect(escaped).toContain("'");
      });

      it('should handle backslashes', () => {
        const input = 'echo \\n newline';
        const escaped = escapeBashCommand(input);

        // Backslashes should be escaped to prevent interpretation
        expect(escaped).toContain('\\\\');
      });
    });
  });
});
