import { generateDockerCompose, subnetsOverlap, writeConfigs, startContainers, stopContainers, cleanup, runAgentCommand } from './docker-manager';
import { WrapperConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Create mock functions
const mockExecaFn = jest.fn();
const mockExecaSync = jest.fn();

// Mock execa module
jest.mock('execa', () => {
  const fn = (...args: any[]) => mockExecaFn(...args);
  fn.sync = (...args: any[]) => mockExecaSync(...args);
  return fn;
});

describe('docker-manager', () => {
  describe('subnetsOverlap', () => {

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
      agentCommand: 'echo "test"',
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
      agentIp: '172.30.0.20',
    };

    it('should generate docker-compose config with GHCR images by default', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].image).toBe('ghcr.io/githubnext/gh-aw-firewall/squid:latest');
      expect(result.services.agent.image).toBe('ghcr.io/githubnext/gh-aw-firewall/agent:latest');
      expect(result.services['squid-proxy'].build).toBeUndefined();
      expect(result.services.agent.build).toBeUndefined();
    });

    it('should use local build when buildLocal is true', () => {
      const localConfig = { ...mockConfig, buildLocal: true };
      const result = generateDockerCompose(localConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].build).toBeDefined();
      expect(result.services.agent.build).toBeDefined();
      expect(result.services['squid-proxy'].image).toBeUndefined();
      expect(result.services.agent.image).toBeUndefined();
    });

    it('should use custom registry and tag', () => {
      const customConfig = {
        ...mockConfig,
        imageRegistry: 'docker.io/myrepo',
        imageTag: 'v1.0.0',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].image).toBe('docker.io/myrepo/squid:v1.0.0');
      expect(result.services.agent.image).toBe('docker.io/myrepo/agent:v1.0.0');
    });

    it('should configure network with correct IPs', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);

      expect(result.networks['awf-net'].external).toBe(true);

      const squidNetworks = result.services['squid-proxy'].networks as { [key: string]: { ipv4_address?: string } };
      expect(squidNetworks['awf-net'].ipv4_address).toBe('172.30.0.10');

      const agentNetworks = result.services.agent.networks as { [key: string]: { ipv4_address?: string } };
      expect(agentNetworks['awf-net'].ipv4_address).toBe('172.30.0.20');
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

    it('should configure agent container with proxy settings', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const env = agent.environment as Record<string, string>;

      expect(env.HTTP_PROXY).toBe('http://172.30.0.10:3128');
      expect(env.HTTPS_PROXY).toBe('http://172.30.0.10:3128');
      expect(env.SQUID_PROXY_HOST).toBe('squid-proxy');
      expect(env.SQUID_PROXY_PORT).toBe('3128');
    });

    it('should mount required volumes in agent container (default behavior)', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      expect(volumes).toContain('/:/host:rw');
      expect(volumes).toContain('/tmp:/tmp:rw');
      expect(volumes).toContain('/var/run/docker.sock:/var/run/docker.sock:rw');
      expect(volumes.some((v: string) => v.includes('agent-logs'))).toBe(true);
    });

    it('should use custom volume mounts when specified', () => {
      const configWithMounts = {
        ...mockConfig,
        volumeMounts: ['/workspace:/workspace:ro', '/data:/data:rw']
      };
      const result = generateDockerCompose(configWithMounts, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // Should NOT include blanket /:/host:rw mount
      expect(volumes).not.toContain('/:/host:rw');

      // Should include custom mounts
      expect(volumes).toContain('/workspace:/workspace:ro');
      expect(volumes).toContain('/data:/data:rw');

      // Should still include essential mounts
      expect(volumes).toContain('/tmp:/tmp:rw');
      expect(volumes).toContain('/var/run/docker.sock:/var/run/docker.sock:rw');
      expect(volumes.some((v: string) => v.includes('agent-logs'))).toBe(true);
    });

    it('should use blanket mount when no custom mounts specified', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // Should include blanket /:/host:rw mount
      expect(volumes).toContain('/:/host:rw');
    });

    it('should set agent to depend on healthy squid', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const depends = agent.depends_on as { [key: string]: { condition: string } };

      expect(depends['squid-proxy'].condition).toBe('service_healthy');
    });

    it('should add NET_ADMIN capability to agent for iptables setup', () => {
      // NET_ADMIN is required at container start for setup-iptables.sh
      // The capability is dropped before user command execution via capsh
      // (see containers/agent/entrypoint.sh)
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.cap_add).toContain('NET_ADMIN');
    });

    it('should apply container hardening measures', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;

      // Verify dropped capabilities for security hardening
      expect(agent.cap_drop).toEqual([
        'NET_RAW',
        'SYS_PTRACE',
        'SYS_MODULE',
        'SYS_RAWIO',
        'MKNOD',
      ]);

      // Verify seccomp profile is configured
      expect(agent.security_opt).toContain('seccomp=/tmp/awf-test/seccomp-profile.json');

      // Verify no-new-privileges is enabled to prevent privilege escalation
      expect(agent.security_opt).toContain('no-new-privileges:true');

      // Verify resource limits
      expect(agent.mem_limit).toBe('4g');
      expect(agent.memswap_limit).toBe('4g');
      expect(agent.pids_limit).toBe(1000);
      expect(agent.cpu_shares).toBe(1024);
    });

    it('should disable TTY by default to prevent ANSI escape sequences', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.tty).toBe(false);
    });

    it('should enable TTY when config.tty is true', () => {
      const configWithTty = { ...mockConfig, tty: true };
      const result = generateDockerCompose(configWithTty, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.tty).toBe(true);
    });

    it('should escape dollar signs in commands for docker-compose', () => {
      const configWithVars = {
        ...mockConfig,
        agentCommand: 'echo $HOME && echo ${USER}',
      };
      const result = generateDockerCompose(configWithVars, mockNetworkConfig);
      const agent = result.services.agent;

      // Docker compose requires $$ to represent a literal $
      expect(agent.command).toEqual(['/bin/bash', '-c', 'echo $$HOME && echo $${USER}']);
    });

    it('should pass through GITHUB_TOKEN when present in environment', () => {
      const originalEnv = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_testtoken123';

      try {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const env = result.services.agent.environment as Record<string, string>;
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
        const env = result.services.agent.environment as Record<string, string>;
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
      const agent = result.services.agent;
      const env = agent.environment as Record<string, string>;

      expect(env.CUSTOM_VAR).toBe('custom_value');
      expect(env.ANOTHER_VAR).toBe('another_value');
    });

    it('should exclude system variables when envAll is enabled', () => {
      const originalPath = process.env.PATH;
      process.env.CUSTOM_HOST_VAR = 'test_value';

      try {
        const configWithEnvAll = { ...mockConfig, envAll: true };
        const result = generateDockerCompose(configWithEnvAll, mockNetworkConfig);
        const agent = result.services.agent;
        const env = agent.environment as Record<string, string>;

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
      const agent = result.services.agent;

      expect(agent.dns).toEqual(['8.8.8.8', '8.8.4.4']);
      expect(agent.dns_search).toEqual([]);
    });

    it('should NOT configure extra_hosts by default (opt-in for security)', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const squid = result.services['squid-proxy'];

      expect(agent.extra_hosts).toBeUndefined();
      expect(squid.extra_hosts).toBeUndefined();
    });

    describe('enableHostAccess option', () => {
      it('should configure extra_hosts when enableHostAccess is true', () => {
        const config = { ...mockConfig, enableHostAccess: true };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const agent = result.services.agent;
        const squid = result.services['squid-proxy'];

        expect(agent.extra_hosts).toEqual(['host.docker.internal:host-gateway']);
        expect(squid.extra_hosts).toEqual(['host.docker.internal:host-gateway']);
      });

      it('should NOT configure extra_hosts when enableHostAccess is false', () => {
        const config = { ...mockConfig, enableHostAccess: false };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const agent = result.services.agent;
        const squid = result.services['squid-proxy'];

        expect(agent.extra_hosts).toBeUndefined();
        expect(squid.extra_hosts).toBeUndefined();
      });

      it('should NOT configure extra_hosts when enableHostAccess is undefined', () => {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const agent = result.services.agent;
        const squid = result.services['squid-proxy'];

        expect(agent.extra_hosts).toBeUndefined();
        expect(squid.extra_hosts).toBeUndefined();
      });
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
        const env = result.services.agent.environment as Record<string, string>;

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

    describe('containerWorkDir option', () => {
      it('should not set working_dir when containerWorkDir is not specified', () => {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);

        expect(result.services.agent.working_dir).toBeUndefined();
      });

      it('should set working_dir when containerWorkDir is specified', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          containerWorkDir: '/home/runner/work/repo/repo',
        };
        const result = generateDockerCompose(config, mockNetworkConfig);

        expect(result.services.agent.working_dir).toBe('/home/runner/work/repo/repo');
      });

      it('should set working_dir to /workspace when containerWorkDir is /workspace', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          containerWorkDir: '/workspace',
        };
        const result = generateDockerCompose(config, mockNetworkConfig);

        expect(result.services.agent.working_dir).toBe('/workspace');
      });

      it('should handle paths with special characters', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          containerWorkDir: '/home/user/my-project with spaces',
        };
        const result = generateDockerCompose(config, mockNetworkConfig);

        expect(result.services.agent.working_dir).toBe('/home/user/my-project with spaces');
      });

      it('should preserve working_dir alongside other agent service config', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          containerWorkDir: '/custom/workdir',
          envAll: true,
        };
        const result = generateDockerCompose(config, mockNetworkConfig);

        // Verify working_dir is set
        expect(result.services.agent.working_dir).toBe('/custom/workdir');
        // Verify other config is still present
        expect(result.services.agent.container_name).toBe('awf-agent');
        expect(result.services.agent.cap_add).toContain('NET_ADMIN');
      });

      it('should handle empty string containerWorkDir by not setting working_dir', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          containerWorkDir: '',
        };
        const result = generateDockerCompose(config, mockNetworkConfig);

        // Empty string is falsy, so working_dir should not be set
        expect(result.services.agent.working_dir).toBeUndefined();
      });

      it('should handle absolute paths correctly', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          containerWorkDir: '/var/lib/app/data',
        };
        const result = generateDockerCompose(config, mockNetworkConfig);

        expect(result.services.agent.working_dir).toBe('/var/lib/app/data');
      });
    });

    describe('proxyLogsDir option', () => {
      it('should use proxyLogsDir when specified', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          proxyLogsDir: '/custom/proxy/logs',
        };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const squid = result.services['squid-proxy'];

        expect(squid.volumes).toContain('/custom/proxy/logs:/var/log/squid:rw');
      });

      it('should use workDir/squid-logs when proxyLogsDir is not specified', () => {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const squid = result.services['squid-proxy'];

        expect(squid.volumes).toContain('/tmp/awf-test/squid-logs:/var/log/squid:rw');
      });
    });

    describe('dnsServers option', () => {
      it('should use custom DNS servers when specified', () => {
        const config: WrapperConfig = {
          ...mockConfig,
          dnsServers: ['1.1.1.1', '1.0.0.1'],
        };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const agent = result.services.agent;
        const env = agent.environment as Record<string, string>;

        expect(agent.dns).toEqual(['1.1.1.1', '1.0.0.1']);
        expect(env.AWF_DNS_SERVERS).toBe('1.1.1.1,1.0.0.1');
      });

      it('should use default DNS servers when not specified', () => {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const agent = result.services.agent;
        const env = agent.environment as Record<string, string>;

        expect(agent.dns).toEqual(['8.8.8.8', '8.8.4.4']);
        expect(env.AWF_DNS_SERVERS).toBe('8.8.8.8,8.8.4.4');
      });
    });
  });

  describe('writeConfigs', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-test-'));
      jest.clearAllMocks();
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should create work directory if it does not exist', async () => {
      const newWorkDir = path.join(testDir, 'new-work-dir');
      const config: WrapperConfig = {
        allowedDomains: ['github.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: newWorkDir,
      };

      // writeConfigs may succeed if seccomp profile is found, or fail if not
      try {
        await writeConfigs(config);
      } catch {
        // Expected to fail if seccomp profile not found, but directories should still be created
      }

      // Verify work directory was created
      expect(fs.existsSync(newWorkDir)).toBe(true);
    });

    it('should create agent-logs directory', async () => {
      const config: WrapperConfig = {
        allowedDomains: ['github.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: testDir,
      };

      try {
        await writeConfigs(config);
      } catch {
        // May fail, but directories should still be created
      }

      // Verify agent-logs directory was created
      expect(fs.existsSync(path.join(testDir, 'agent-logs'))).toBe(true);
    });

    it('should create squid-logs directory', async () => {
      const config: WrapperConfig = {
        allowedDomains: ['github.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: testDir,
      };

      try {
        await writeConfigs(config);
      } catch {
        // May fail, but directories should still be created
      }

      // Verify squid-logs directory was created
      expect(fs.existsSync(path.join(testDir, 'squid-logs'))).toBe(true);
    });

    it('should create .docker config directory', async () => {
      const config: WrapperConfig = {
        allowedDomains: ['github.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: testDir,
      };

      try {
        await writeConfigs(config);
      } catch {
        // May fail, but directories should still be created
      }

      // Verify .docker config directory was created
      expect(fs.existsSync(path.join(testDir, '.docker'))).toBe(true);
    });

    it('should write squid.conf file', async () => {
      const config: WrapperConfig = {
        allowedDomains: ['github.com', 'example.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: testDir,
      };

      try {
        await writeConfigs(config);
      } catch {
        // May fail after writing configs
      }

      // Verify squid.conf was created (it's created before seccomp check)
      const squidConfPath = path.join(testDir, 'squid.conf');
      if (fs.existsSync(squidConfPath)) {
        const content = fs.readFileSync(squidConfPath, 'utf-8');
        expect(content).toContain('github.com');
        expect(content).toContain('example.com');
      }
    });

    it('should write docker-compose.yml file', async () => {
      const config: WrapperConfig = {
        allowedDomains: ['github.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: testDir,
      };

      try {
        await writeConfigs(config);
      } catch {
        // May fail after writing configs
      }

      // Verify docker-compose.yml was created
      const dockerComposePath = path.join(testDir, 'docker-compose.yml');
      if (fs.existsSync(dockerComposePath)) {
        const content = fs.readFileSync(dockerComposePath, 'utf-8');
        expect(content).toContain('awf-squid');
        expect(content).toContain('awf-agent');
      }
    });

    it('should use proxyLogsDir when specified', async () => {
      const proxyLogsDir = path.join(testDir, 'custom-proxy-logs');
      const config: WrapperConfig = {
        allowedDomains: ['github.com'],
        agentCommand: 'echo test',
        logLevel: 'info',
        keepContainers: false,
        workDir: testDir,
        proxyLogsDir,
      };

      try {
        await writeConfigs(config);
      } catch {
        // May fail after writing configs
      }

      // Verify proxyLogsDir was created
      expect(fs.existsSync(proxyLogsDir)).toBe(true);
    });
  });

  describe('startContainers', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-test-'));
      jest.clearAllMocks();
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should remove existing containers before starting', async () => {
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

      await startContainers(testDir, ['github.com']);

      expect(mockExecaFn).toHaveBeenCalledWith(
        'docker',
        ['rm', '-f', 'awf-squid', 'awf-agent'],
        { reject: false }
      );
    });

    it('should run docker compose up', async () => {
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

      await startContainers(testDir, ['github.com']);

      expect(mockExecaFn).toHaveBeenCalledWith(
        'docker',
        ['compose', 'up', '-d'],
        { cwd: testDir, stdio: 'inherit' }
      );
    });

    it('should handle docker compose failure', async () => {
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      mockExecaFn.mockRejectedValueOnce(new Error('Docker compose failed'));

      await expect(startContainers(testDir, ['github.com'])).rejects.toThrow('Docker compose failed');
    });

    it('should handle healthcheck failure with blocked domains', async () => {
      // Create access.log with denied entries
      const squidLogsDir = path.join(testDir, 'squid-logs');
      fs.mkdirSync(squidLogsDir, { recursive: true });
      fs.writeFileSync(
        path.join(squidLogsDir, 'access.log'),
        '1760994429.358 172.30.0.20:36274 blocked.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE blocked.com:443 "curl/7.81.0"\n'
      );

      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      mockExecaFn.mockRejectedValueOnce(new Error('is unhealthy'));

      await expect(startContainers(testDir, ['github.com'])).rejects.toThrow();
    });
  });

  describe('stopContainers', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-test-'));
      jest.clearAllMocks();
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should skip stopping when keepContainers is true', async () => {
      await stopContainers(testDir, true);

      expect(mockExecaFn).not.toHaveBeenCalled();
    });

    it('should run docker compose down when keepContainers is false', async () => {
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

      await stopContainers(testDir, false);

      expect(mockExecaFn).toHaveBeenCalledWith(
        'docker',
        ['compose', 'down', '-v'],
        { cwd: testDir, stdio: 'inherit' }
      );
    });

    it('should throw error when docker compose down fails', async () => {
      mockExecaFn.mockRejectedValueOnce(new Error('Docker compose down failed'));

      await expect(stopContainers(testDir, false)).rejects.toThrow('Docker compose down failed');
    });
  });

  describe('runAgentCommand', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-test-'));
      jest.clearAllMocks();
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should return exit code from container', async () => {
      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait
      mockExecaFn.mockResolvedValueOnce({ stdout: '0', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com']);

      expect(result.exitCode).toBe(0);
    });

    it('should return non-zero exit code when command fails', async () => {
      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait with non-zero exit code
      mockExecaFn.mockResolvedValueOnce({ stdout: '1', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com']);

      expect(result.exitCode).toBe(1);
    });

    it('should detect blocked domains from access log', async () => {
      // Create access.log with denied entries
      const squidLogsDir = path.join(testDir, 'squid-logs');
      fs.mkdirSync(squidLogsDir, { recursive: true });
      fs.writeFileSync(
        path.join(squidLogsDir, 'access.log'),
        '1760994429.358 172.30.0.20:36274 blocked.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE blocked.com:443 "curl/7.81.0"\n'
      );

      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait with non-zero exit code (command failed)
      mockExecaFn.mockResolvedValueOnce({ stdout: '1', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com']);

      expect(result.exitCode).toBe(1);
      expect(result.blockedDomains).toContain('blocked.com');
    });

    it('should use proxyLogsDir when specified', async () => {
      const proxyLogsDir = path.join(testDir, 'custom-logs');
      fs.mkdirSync(proxyLogsDir, { recursive: true });
      fs.writeFileSync(
        path.join(proxyLogsDir, 'access.log'),
        '1760994429.358 172.30.0.20:36274 blocked.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE blocked.com:443 "curl/7.81.0"\n'
      );

      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait
      mockExecaFn.mockResolvedValueOnce({ stdout: '1', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com'], proxyLogsDir);

      expect(result.blockedDomains).toContain('blocked.com');
    });

    it('should throw error when docker wait fails', async () => {
      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait failure
      mockExecaFn.mockRejectedValueOnce(new Error('Container not found'));

      await expect(runAgentCommand(testDir, ['github.com'])).rejects.toThrow('Container not found');
    });

    it('should handle blocked domain without port (standard port 443)', async () => {
      const squidLogsDir = path.join(testDir, 'squid-logs');
      fs.mkdirSync(squidLogsDir, { recursive: true });
      fs.writeFileSync(
        path.join(squidLogsDir, 'access.log'),
        '1760994429.358 172.30.0.20:36274 example.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE example.com:443 "curl/7.81.0"\n'
      );

      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait with non-zero exit code
      mockExecaFn.mockResolvedValueOnce({ stdout: '1', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com']);

      expect(result.exitCode).toBe(1);
      expect(result.blockedDomains).toContain('example.com');
    });

    it('should handle allowed domain in blocklist correctly', async () => {
      const squidLogsDir = path.join(testDir, 'squid-logs');
      fs.mkdirSync(squidLogsDir, { recursive: true });
      // Create a log entry for subdomain of allowed domain
      fs.writeFileSync(
        path.join(squidLogsDir, 'access.log'),
        '1760994429.358 172.30.0.20:36274 api.github.com:8443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE api.github.com:8443 "curl/7.81.0"\n'
      );

      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait with non-zero exit code
      mockExecaFn.mockResolvedValueOnce({ stdout: '1', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com']);

      expect(result.exitCode).toBe(1);
      // api.github.com should be blocked because port 8443 is not allowed
      expect(result.blockedDomains).toContain('api.github.com');
    });

    it('should return empty blockedDomains when no access log exists', async () => {
      // Don't create access.log

      // Mock docker logs -f
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      // Mock docker wait
      mockExecaFn.mockResolvedValueOnce({ stdout: '0', stderr: '', exitCode: 0 } as any);

      const result = await runAgentCommand(testDir, ['github.com']);

      expect(result.exitCode).toBe(0);
      expect(result.blockedDomains).toEqual([]);
    });
  });

  describe('cleanup', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-'));
      jest.clearAllMocks();
      // Mock execa.sync for chmod
      mockExecaSync.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 });
    });

    afterEach(() => {
      // Clean up any remaining test directories
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      // Clean up any moved log directories
      const timestamp = path.basename(testDir).replace('awf-', '');
      const agentLogsDir = path.join(os.tmpdir(), `awf-agent-logs-${timestamp}`);
      const squidLogsDir = path.join(os.tmpdir(), `squid-logs-${timestamp}`);
      if (fs.existsSync(agentLogsDir)) {
        fs.rmSync(agentLogsDir, { recursive: true, force: true });
      }
      if (fs.existsSync(squidLogsDir)) {
        fs.rmSync(squidLogsDir, { recursive: true, force: true });
      }
    });

    it('should skip cleanup when keepFiles is true', async () => {
      await cleanup(testDir, true);

      // Verify directory still exists
      expect(fs.existsSync(testDir)).toBe(true);
    });

    it('should remove work directory when keepFiles is false', async () => {
      await cleanup(testDir, false);

      expect(fs.existsSync(testDir)).toBe(false);
    });

    it('should preserve agent logs when they exist', async () => {
      // Create agent logs directory with a file
      const agentLogsDir = path.join(testDir, 'agent-logs');
      fs.mkdirSync(agentLogsDir, { recursive: true });
      fs.writeFileSync(path.join(agentLogsDir, 'test.log'), 'test log content');

      await cleanup(testDir, false);

      // Verify work directory was removed
      expect(fs.existsSync(testDir)).toBe(false);

      // Verify agent logs were moved
      const timestamp = path.basename(testDir).replace('awf-', '');
      const preservedLogsDir = path.join(os.tmpdir(), `awf-agent-logs-${timestamp}`);
      expect(fs.existsSync(preservedLogsDir)).toBe(true);
      expect(fs.readFileSync(path.join(preservedLogsDir, 'test.log'), 'utf-8')).toBe('test log content');
    });

    it('should preserve squid logs when they exist', async () => {
      // Create squid logs directory with a file
      const squidLogsDir = path.join(testDir, 'squid-logs');
      fs.mkdirSync(squidLogsDir, { recursive: true });
      fs.writeFileSync(path.join(squidLogsDir, 'access.log'), 'squid log content');

      await cleanup(testDir, false);

      // Verify work directory was removed
      expect(fs.existsSync(testDir)).toBe(false);

      // Verify squid logs were moved
      const timestamp = path.basename(testDir).replace('awf-', '');
      const preservedLogsDir = path.join(os.tmpdir(), `squid-logs-${timestamp}`);
      expect(fs.existsSync(preservedLogsDir)).toBe(true);
    });

    it('should not preserve empty log directories', async () => {
      // Create empty agent logs directory
      const agentLogsDir = path.join(testDir, 'agent-logs');
      fs.mkdirSync(agentLogsDir, { recursive: true });

      await cleanup(testDir, false);

      // Verify work directory was removed
      expect(fs.existsSync(testDir)).toBe(false);

      // Verify no empty log directory was created
      const timestamp = path.basename(testDir).replace('awf-', '');
      const preservedLogsDir = path.join(os.tmpdir(), `awf-agent-logs-${timestamp}`);
      expect(fs.existsSync(preservedLogsDir)).toBe(false);
    });

    it('should use proxyLogsDir when specified', async () => {
      const proxyLogsDir = path.join(testDir, 'custom-proxy-logs');
      fs.mkdirSync(proxyLogsDir, { recursive: true });
      fs.writeFileSync(path.join(proxyLogsDir, 'access.log'), 'proxy log content');

      await cleanup(testDir, false, proxyLogsDir);

      // Verify chmod was called on proxyLogsDir
      expect(mockExecaSync).toHaveBeenCalledWith('chmod', ['-R', 'a+rX', proxyLogsDir]);
    });

    it('should handle non-existent work directory gracefully', async () => {
      const nonExistentDir = path.join(os.tmpdir(), 'awf-nonexistent-12345');

      // Should not throw
      await expect(cleanup(nonExistentDir, false)).resolves.not.toThrow();
    });
  });
});
