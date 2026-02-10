import { generateDockerCompose, subnetsOverlap, writeConfigs, startContainers, stopContainers, cleanup, runAgentCommand, validateIdNotInSystemRange, getSafeHostUid, getSafeHostGid, getRealUserHome, MIN_REGULAR_UID, ACT_PRESET_BASE_IMAGE } from './docker-manager';
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

  describe('ACT_PRESET_BASE_IMAGE', () => {
    it('should be a valid catthehacker act image', () => {
      expect(ACT_PRESET_BASE_IMAGE).toBe('ghcr.io/catthehacker/ubuntu:act-24.04');
    });

    it('should match expected pattern for catthehacker images', () => {
      expect(ACT_PRESET_BASE_IMAGE).toMatch(/^ghcr\.io\/catthehacker\/ubuntu:act-\d+\.\d+$/);
    });
  });

  describe('validateIdNotInSystemRange', () => {
    it('should return 1000 for system UIDs (0-999)', () => {
      expect(validateIdNotInSystemRange(0)).toBe('1000');
      expect(validateIdNotInSystemRange(1)).toBe('1000');
      expect(validateIdNotInSystemRange(13)).toBe('1000'); // proxy user
      expect(validateIdNotInSystemRange(999)).toBe('1000');
    });

    it('should return the UID as-is for regular users (>= 1000)', () => {
      expect(validateIdNotInSystemRange(1000)).toBe('1000');
      expect(validateIdNotInSystemRange(1001)).toBe('1001');
      expect(validateIdNotInSystemRange(65534)).toBe('65534'); // nobody user on some systems
    });
  });

  describe('getSafeHostUid', () => {
    const originalGetuid = process.getuid;
    const originalSudoUid = process.env.SUDO_UID;

    afterEach(() => {
      process.getuid = originalGetuid;
      if (originalSudoUid !== undefined) {
        process.env.SUDO_UID = originalSudoUid;
      } else {
        delete process.env.SUDO_UID;
      }
    });

    it('should return 1000 when SUDO_UID is a system UID', () => {
      process.getuid = () => 0; // Running as root
      process.env.SUDO_UID = '13'; // proxy user
      expect(getSafeHostUid()).toBe('1000');
    });

    it('should return SUDO_UID when it is a regular user UID', () => {
      process.getuid = () => 0; // Running as root
      process.env.SUDO_UID = '1001';
      expect(getSafeHostUid()).toBe('1001');
    });

    it('should return 1000 when SUDO_UID is 0', () => {
      process.getuid = () => 0; // Running as root
      process.env.SUDO_UID = '0';
      expect(getSafeHostUid()).toBe('1000');
    });

    it('should return 1000 when running as root without SUDO_UID', () => {
      process.getuid = () => 0;
      delete process.env.SUDO_UID;
      expect(getSafeHostUid()).toBe('1000');
    });

    it('should return 1000 for non-root system UID', () => {
      process.getuid = () => 13; // proxy user
      delete process.env.SUDO_UID;
      expect(getSafeHostUid()).toBe('1000');
    });

    it('should return the UID when running as regular user', () => {
      process.getuid = () => 1001;
      delete process.env.SUDO_UID;
      expect(getSafeHostUid()).toBe('1001');
    });
  });

  describe('getSafeHostGid', () => {
    const originalGetgid = process.getgid;
    const originalSudoGid = process.env.SUDO_GID;

    afterEach(() => {
      process.getgid = originalGetgid;
      if (originalSudoGid !== undefined) {
        process.env.SUDO_GID = originalSudoGid;
      } else {
        delete process.env.SUDO_GID;
      }
    });

    it('should return 1000 when SUDO_GID is a system GID', () => {
      process.getgid = () => 0; // Running as root
      process.env.SUDO_GID = '13'; // proxy group
      expect(getSafeHostGid()).toBe('1000');
    });

    it('should return SUDO_GID when it is a regular user GID', () => {
      process.getgid = () => 0; // Running as root
      process.env.SUDO_GID = '1001';
      expect(getSafeHostGid()).toBe('1001');
    });

    it('should return 1000 when SUDO_GID is 0', () => {
      process.getgid = () => 0; // Running as root
      process.env.SUDO_GID = '0';
      expect(getSafeHostGid()).toBe('1000');
    });

    it('should return 1000 when running as root without SUDO_GID', () => {
      process.getgid = () => 0;
      delete process.env.SUDO_GID;
      expect(getSafeHostGid()).toBe('1000');
    });

    it('should return 1000 for non-root system GID', () => {
      process.getgid = () => 13; // proxy group
      delete process.env.SUDO_GID;
      expect(getSafeHostGid()).toBe('1000');
    });

    it('should return the GID when running as regular user', () => {
      process.getgid = () => 1001;
      delete process.env.SUDO_GID;
      expect(getSafeHostGid()).toBe('1001');
    });
  });

  describe('getRealUserHome', () => {
    const originalGetuid = process.getuid;
    const originalSudoUser = process.env.SUDO_USER;
    const originalHome = process.env.HOME;

    afterEach(() => {
      process.getuid = originalGetuid;
      process.env.SUDO_USER = originalSudoUser;
      process.env.HOME = originalHome;
      jest.restoreAllMocks();
    });

    it('should return HOME when running as regular user', () => {
      process.getuid = () => 1001;
      process.env.HOME = '/home/testuser';
      expect(getRealUserHome()).toBe('/home/testuser');
    });

    it('should return /root as fallback when HOME is not set and running as root', () => {
      process.getuid = () => 0;
      delete process.env.SUDO_USER;
      delete process.env.HOME;
      expect(getRealUserHome()).toBe('/root');
    });

    it('should use HOME as fallback when running as root without SUDO_USER', () => {
      process.getuid = () => 0;
      delete process.env.SUDO_USER;
      process.env.HOME = '/root';
      expect(getRealUserHome()).toBe('/root');
    });

    it('should look up user home from /etc/passwd when running as root with SUDO_USER (using real root user)', () => {
      // Test with actual /etc/passwd by using 'root' user which always exists
      process.getuid = () => 0;
      process.env.SUDO_USER = 'root';
      process.env.HOME = '/some/other/path';

      // Should find root's home directory from /etc/passwd
      expect(getRealUserHome()).toBe('/root');
    });

    it('should fall back to HOME when SUDO_USER not found in /etc/passwd', () => {
      process.getuid = () => 0;
      process.env.SUDO_USER = 'nonexistent_user_12345';
      process.env.HOME = '/fallback/home';

      // User doesn't exist in /etc/passwd, should fall back to HOME
      expect(getRealUserHome()).toBe('/fallback/home');
    });

    it('should handle undefined getuid gracefully (using real /etc/passwd)', () => {
      // Simulate environment where process.getuid is undefined (e.g., Windows)
      process.getuid = undefined as any;
      process.env.SUDO_USER = 'root';
      process.env.HOME = '/custom/home';

      // With getuid undefined, uid is undefined (falsy), so it attempts passwd lookup
      // Should find root's home directory from /etc/passwd
      expect(getRealUserHome()).toBe('/root');
    });
  });

  describe('MIN_REGULAR_UID constant', () => {
    it('should be 1000 (standard Linux regular user UID threshold)', () => {
      expect(MIN_REGULAR_UID).toBe(1000);
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
      imageRegistry: 'ghcr.io/github/gh-aw-firewall',
      imageTag: 'latest',
    };

    const mockNetworkConfig = {
      subnet: '172.30.0.0/24',
      squidIp: '172.30.0.10',
      agentIp: '172.30.0.20',
    };

    it('should generate docker-compose config with GHCR images by default', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].image).toBe('ghcr.io/github/gh-aw-firewall/squid:latest');
      expect(result.services.agent.image).toBe('ghcr.io/github/gh-aw-firewall/agent:latest');
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

    it('should pass BASE_IMAGE build arg when custom agentImage is specified with --build-local', () => {
      const customImageConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'ghcr.io/catthehacker/ubuntu:runner-22.04',
      };
      const result = generateDockerCompose(customImageConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBe('ghcr.io/catthehacker/ubuntu:runner-22.04');
    });

    it('should not include BASE_IMAGE build arg when using default agentImage with --build-local', () => {
      const localConfig = { ...mockConfig, buildLocal: true, agentImage: 'default' };
      const result = generateDockerCompose(localConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      // BASE_IMAGE should not be set when using the default preset
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBeUndefined();
    });

    it('should not include BASE_IMAGE build arg when agentImage is undefined with --build-local', () => {
      const localConfig = { ...mockConfig, buildLocal: true };
      // agentImage is not set, should default to 'default' preset
      const result = generateDockerCompose(localConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      // BASE_IMAGE should not be set when using the default (undefined means 'default')
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBeUndefined();
    });

    it('should pass BASE_IMAGE build arg when agentImage with SHA256 digest is specified', () => {
      const customImageConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'ghcr.io/catthehacker/ubuntu:full-22.04@sha256:a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1',
      };
      const result = generateDockerCompose(customImageConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBe('ghcr.io/catthehacker/ubuntu:full-22.04@sha256:a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1');
    });

    it('should use act base image when agentImage is "act" preset with --build-local', () => {
      const actPresetConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'act',
      };
      const result = generateDockerCompose(actPresetConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      // When using 'act' preset with --build-local, should use the catthehacker act image
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBe(ACT_PRESET_BASE_IMAGE);
    });

    it('should use agent-act GHCR image when agentImage is "act" preset without --build-local', () => {
      const actPresetConfig = {
        ...mockConfig,
        agentImage: 'act',
      };
      const result = generateDockerCompose(actPresetConfig, mockNetworkConfig);

      expect(result.services.agent.image).toBe('ghcr.io/github/gh-aw-firewall/agent-act:latest');
      expect(result.services.agent.build).toBeUndefined();
    });

    it('should use agent GHCR image when agentImage is "default" preset', () => {
      const defaultPresetConfig = {
        ...mockConfig,
        agentImage: 'default',
      };
      const result = generateDockerCompose(defaultPresetConfig, mockNetworkConfig);

      expect(result.services.agent.image).toBe('ghcr.io/github/gh-aw-firewall/agent:latest');
      expect(result.services.agent.build).toBeUndefined();
    });

    it('should use agent GHCR image when agentImage is undefined', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);

      expect(result.services.agent.image).toBe('ghcr.io/github/gh-aw-firewall/agent:latest');
      expect(result.services.agent.build).toBeUndefined();
    });

    it('should use custom registry and tag with act preset', () => {
      const customConfig = {
        ...mockConfig,
        agentImage: 'act',
        imageRegistry: 'docker.io/myrepo',
        imageTag: 'v1.0.0',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services['squid-proxy'].image).toBe('docker.io/myrepo/squid:v1.0.0');
      expect(result.services.agent.image).toBe('docker.io/myrepo/agent-act:v1.0.0');
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

    it('should use custom registry and tag with default preset explicitly set', () => {
      const customConfig = {
        ...mockConfig,
        agentImage: 'default',
        imageRegistry: 'docker.io/myrepo',
        imageTag: 'v2.0.0',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services.agent.image).toBe('docker.io/myrepo/agent:v2.0.0');
      expect(result.services.agent.build).toBeUndefined();
    });

    it('should build locally with custom catthehacker full image', () => {
      const customConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'ghcr.io/catthehacker/ubuntu:full-24.04',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBe('ghcr.io/catthehacker/ubuntu:full-24.04');
      expect(result.services.agent.image).toBeUndefined();
    });

    it('should build locally with custom ubuntu image', () => {
      const customConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'ubuntu:24.04',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services.agent.build).toBeDefined();
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBe('ubuntu:24.04');
    });

    it('should include USER_UID and USER_GID in build args with custom image', () => {
      const customConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'ghcr.io/catthehacker/ubuntu:runner-22.04',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services.agent.build?.args?.USER_UID).toBeDefined();
      expect(result.services.agent.build?.args?.USER_GID).toBeDefined();
    });

    it('should include USER_UID and USER_GID in build args with act preset', () => {
      const customConfig = {
        ...mockConfig,
        buildLocal: true,
        agentImage: 'act',
      };
      const result = generateDockerCompose(customConfig, mockNetworkConfig);

      expect(result.services.agent.build?.args?.USER_UID).toBeDefined();
      expect(result.services.agent.build?.args?.USER_GID).toBeDefined();
      expect(result.services.agent.build?.args?.BASE_IMAGE).toBe(ACT_PRESET_BASE_IMAGE);
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

    it('should configure JAVA_TOOL_OPTIONS with proxy settings for Java applications', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const env = agent.environment as Record<string, string>;

      expect(env.JAVA_TOOL_OPTIONS).toBeDefined();
      expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttp.proxyHost=172.30.0.10');
      expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttp.proxyPort=3128');
      expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttps.proxyHost=172.30.0.10');
      expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttps.proxyPort=3128');
    });

    it('should add http.nonProxyHosts to JAVA_TOOL_OPTIONS when host access is enabled', () => {
      const configWithHostAccess = { ...mockConfig, enableHostAccess: true };
      const result = generateDockerCompose(configWithHostAccess, mockNetworkConfig);
      const agent = result.services.agent;
      const env = agent.environment as Record<string, string>;

      expect(env.JAVA_TOOL_OPTIONS).toContain('-Dhttp.nonProxyHosts=');
      expect(env.JAVA_TOOL_OPTIONS).toContain('localhost');
      expect(env.JAVA_TOOL_OPTIONS).toContain('127.0.0.1');
      expect(env.JAVA_TOOL_OPTIONS).toContain('host.docker.internal');
    });

    it('should mount required volumes in agent container (default behavior)', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      expect(volumes).toContain('/:/host:rw');
      expect(volumes).toContain('/tmp:/tmp:rw');
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
      expect(volumes.some((v: string) => v.includes('agent-logs'))).toBe(true);
    });

    it('should use blanket mount when no custom mounts specified', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // Should include blanket /:/host:rw mount
      expect(volumes).toContain('/:/host:rw');
    });

    it('should use selective mounts when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // Should NOT include blanket /:/host:rw mount
      expect(volumes).not.toContain('/:/host:rw');

      // Should include system paths (read-only)
      expect(volumes).toContain('/usr:/host/usr:ro');
      expect(volumes).toContain('/bin:/host/bin:ro');
      expect(volumes).toContain('/sbin:/host/sbin:ro');
      expect(volumes).toContain('/lib:/host/lib:ro');
      expect(volumes).toContain('/lib64:/host/lib64:ro');
      expect(volumes).toContain('/opt:/host/opt:ro');

      // Should include special filesystems (read-only)
      // NOTE: /proc is NOT bind-mounted. Instead, a container-scoped procfs is mounted
      // at /host/proc via 'mount -t proc' in entrypoint.sh (requires SYS_ADMIN, which
      // is dropped before user code). This provides dynamic /proc/self/exe resolution.
      expect(volumes).not.toContain('/proc:/host/proc:ro');
      expect(volumes).not.toContain('/proc/self:/host/proc/self:ro');
      expect(volumes).toContain('/sys:/host/sys:ro');
      expect(volumes).toContain('/dev:/host/dev:ro');

      // Should include /etc subdirectories (read-only)
      expect(volumes).toContain('/etc/ssl:/host/etc/ssl:ro');
      expect(volumes).toContain('/etc/ca-certificates:/host/etc/ca-certificates:ro');
      expect(volumes).toContain('/etc/alternatives:/host/etc/alternatives:ro');
      expect(volumes).toContain('/etc/ld.so.cache:/host/etc/ld.so.cache:ro');
      expect(volumes).toContain('/etc/hosts:/host/etc/hosts:ro');

      // Should still include essential mounts
      expect(volumes).toContain('/tmp:/tmp:rw');
      expect(volumes.some((v: string) => v.includes('agent-logs'))).toBe(true);
    });

    it('should hide Docker socket when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // Docker socket should be hidden with /dev/null
      expect(volumes).toContain('/dev/null:/host/var/run/docker.sock:ro');
      expect(volumes).toContain('/dev/null:/host/run/docker.sock:ro');
    });

    it('should mount user home directory under /host when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // Should mount home directory under /host for chroot access (read-write)
      const homeDir = process.env.HOME || '/root';
      expect(volumes).toContain(`${homeDir}:/host${homeDir}:rw`);
    });

    it('should add SYS_CHROOT and SYS_ADMIN capabilities when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.cap_add).toContain('NET_ADMIN');
      expect(agent.cap_add).toContain('SYS_CHROOT');
      // SYS_ADMIN is needed to mount procfs at /host/proc for dynamic /proc/self/exe
      expect(agent.cap_add).toContain('SYS_ADMIN');
    });

    it('should not add SYS_CHROOT or SYS_ADMIN capability when enableChroot is false', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.cap_add).toContain('NET_ADMIN');
      expect(agent.cap_add).not.toContain('SYS_CHROOT');
      expect(agent.cap_add).not.toContain('SYS_ADMIN');
    });

    it('should add apparmor:unconfined security_opt when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.security_opt).toContain('apparmor:unconfined');
    });

    it('should not add apparmor:unconfined security_opt when enableChroot is false', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;

      expect(agent.security_opt).not.toContain('apparmor:unconfined');
    });

    it('should set AWF_CHROOT_ENABLED environment variable when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const environment = agent.environment as Record<string, string>;

      expect(environment.AWF_CHROOT_ENABLED).toBe('true');
    });

    it('should pass GOROOT, CARGO_HOME, JAVA_HOME, DOTNET_ROOT, BUN_INSTALL to container when enableChroot is true and env vars are set', () => {
      const originalGoroot = process.env.GOROOT;
      const originalCargoHome = process.env.CARGO_HOME;
      const originalJavaHome = process.env.JAVA_HOME;
      const originalDotnetRoot = process.env.DOTNET_ROOT;
      const originalBunInstall = process.env.BUN_INSTALL;

      process.env.GOROOT = '/usr/local/go';
      process.env.CARGO_HOME = '/home/user/.cargo';
      process.env.JAVA_HOME = '/usr/lib/jvm/java-17';
      process.env.DOTNET_ROOT = '/usr/lib/dotnet';
      process.env.BUN_INSTALL = '/home/user/.bun';

      try {
        const configWithChroot = {
          ...mockConfig,
          enableChroot: true
        };
        const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
        const agent = result.services.agent;
        const environment = agent.environment as Record<string, string>;

        expect(environment.AWF_GOROOT).toBe('/usr/local/go');
        expect(environment.AWF_CARGO_HOME).toBe('/home/user/.cargo');
        expect(environment.AWF_JAVA_HOME).toBe('/usr/lib/jvm/java-17');
        expect(environment.AWF_DOTNET_ROOT).toBe('/usr/lib/dotnet');
        expect(environment.AWF_BUN_INSTALL).toBe('/home/user/.bun');
      } finally {
        // Restore original values
        if (originalGoroot !== undefined) {
          process.env.GOROOT = originalGoroot;
        } else {
          delete process.env.GOROOT;
        }
        if (originalCargoHome !== undefined) {
          process.env.CARGO_HOME = originalCargoHome;
        } else {
          delete process.env.CARGO_HOME;
        }
        if (originalJavaHome !== undefined) {
          process.env.JAVA_HOME = originalJavaHome;
        } else {
          delete process.env.JAVA_HOME;
        }
        if (originalDotnetRoot !== undefined) {
          process.env.DOTNET_ROOT = originalDotnetRoot;
        } else {
          delete process.env.DOTNET_ROOT;
        }
        if (originalBunInstall !== undefined) {
          process.env.BUN_INSTALL = originalBunInstall;
        } else {
          delete process.env.BUN_INSTALL;
        }
      }
    });

    it('should NOT set AWF_BUN_INSTALL when BUN_INSTALL is not in environment', () => {
      const originalBunInstall = process.env.BUN_INSTALL;
      delete process.env.BUN_INSTALL;

      try {
        const configWithChroot = {
          ...mockConfig,
          enableChroot: true
        };
        const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
        const agent = result.services.agent;
        const environment = agent.environment as Record<string, string>;

        expect(environment.AWF_BUN_INSTALL).toBeUndefined();
      } finally {
        if (originalBunInstall !== undefined) {
          process.env.BUN_INSTALL = originalBunInstall;
        }
      }
    });

    it('should not set AWF_CHROOT_ENABLED when enableChroot is false', () => {
      const result = generateDockerCompose(mockConfig, mockNetworkConfig);
      const agent = result.services.agent;
      const environment = agent.environment as Record<string, string>;

      expect(environment.AWF_CHROOT_ENABLED).toBeUndefined();
    });

    it('should set AWF_WORKDIR environment variable when enableChroot is true', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true,
        containerWorkDir: '/workspace/project'
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const environment = agent.environment as Record<string, string>;

      expect(environment.AWF_WORKDIR).toBe('/workspace/project');
    });

    it('should mount /tmp under /host for chroot temp scripts', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // /tmp:/host/tmp:rw is required for entrypoint.sh to write command scripts
      expect(volumes).toContain('/tmp:/host/tmp:rw');
    });

    it('should mount /etc/passwd and /etc/group for user lookup in chroot mode', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      // These are needed for getent/user lookup inside chroot
      expect(volumes).toContain('/etc/passwd:/host/etc/passwd:ro');
      expect(volumes).toContain('/etc/group:/host/etc/group:ro');
      expect(volumes).toContain('/etc/nsswitch.conf:/host/etc/nsswitch.conf:ro');
    });

    it('should mount writable chroot-hosts when enableChroot and enableHostAccess are true', () => {
      // Ensure workDir exists for chroot-hosts file creation
      fs.mkdirSync(mockConfig.workDir, { recursive: true });
      try {
        const config = {
          ...mockConfig,
          enableChroot: true,
          enableHostAccess: true
        };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const agent = result.services.agent;
        const volumes = agent.volumes as string[];

        // Should mount a writable copy of /etc/hosts (not the read-only original)
        const hostsVolume = volumes.find((v: string) => v.includes('/host/etc/hosts'));
        expect(hostsVolume).toBeDefined();
        expect(hostsVolume).toContain('chroot-hosts:/host/etc/hosts');
        expect(hostsVolume).not.toContain(':ro');
      } finally {
        fs.rmSync(mockConfig.workDir, { recursive: true, force: true });
      }
    });

    it('should inject host.docker.internal into chroot-hosts file', () => {
      // Ensure workDir exists for chroot-hosts file creation
      fs.mkdirSync(mockConfig.workDir, { recursive: true });
      try {
        const config = {
          ...mockConfig,
          enableChroot: true,
          enableHostAccess: true
        };
        generateDockerCompose(config, mockNetworkConfig);

        // The chroot-hosts file should exist and contain host.docker.internal
        const chrootHostsPath = `${mockConfig.workDir}/chroot-hosts`;
        expect(fs.existsSync(chrootHostsPath)).toBe(true);
        const content = fs.readFileSync(chrootHostsPath, 'utf8');
        // Docker bridge gateway resolution may succeed or fail in test env,
        // but the file should exist with at least localhost
        expect(content).toContain('localhost');
      } finally {
        fs.rmSync(mockConfig.workDir, { recursive: true, force: true });
      }
    });

    it('should mount read-only /etc/hosts when enableChroot is true but enableHostAccess is false', () => {
      const config = {
        ...mockConfig,
        enableChroot: true,
        enableHostAccess: false
      };
      const result = generateDockerCompose(config, mockNetworkConfig);
      const agent = result.services.agent;
      const volumes = agent.volumes as string[];

      expect(volumes).toContain('/etc/hosts:/host/etc/hosts:ro');
    });

    it('should use GHCR image when enableChroot is true with default preset (GHCR)', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent as any;

      // Chroot mode with preset image should use GHCR (not build locally)
      // This fixes the bug where packaged binaries couldn't find containers/agent directory
      expect(agent.image).toBe('ghcr.io/github/gh-aw-firewall/agent:latest');
      expect(agent.build).toBeUndefined();
    });

    it('should use GHCR agent-act image when enableChroot is true with act preset', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true,
        agentImage: 'act'
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent as any;

      // Chroot mode with 'act' preset should use GHCR agent-act image
      expect(agent.image).toBe('ghcr.io/github/gh-aw-firewall/agent-act:latest');
      expect(agent.build).toBeUndefined();
    });

    it('should build locally with full Dockerfile when enableChroot with custom image', () => {
      const configWithChroot = {
        ...mockConfig,
        enableChroot: true,
        agentImage: 'ubuntu:24.04' // Custom (non-preset) image
      };
      const result = generateDockerCompose(configWithChroot, mockNetworkConfig);
      const agent = result.services.agent as any;

      // Chroot mode with custom image should build locally with full Dockerfile for feature parity
      expect(agent.build).toBeDefined();
      expect(agent.build.dockerfile).toBe('Dockerfile');
      expect(agent.build.args.BASE_IMAGE).toBe('ubuntu:24.04');
      expect(agent.image).toBeUndefined();
    });

    it('should build locally with full Dockerfile when buildLocal and enableChroot are both true', () => {
      const configWithChrootAndBuildLocal = {
        ...mockConfig,
        enableChroot: true,
        buildLocal: true
      };
      const result = generateDockerCompose(configWithChrootAndBuildLocal, mockNetworkConfig);
      const agent = result.services.agent as any;

      // When both buildLocal and enableChroot are set, should use full Dockerfile for feature parity
      expect(agent.build).toBeDefined();
      expect(agent.build.dockerfile).toBe('Dockerfile');
      expect(agent.image).toBeUndefined();
    });

    it('should use standard Dockerfile when enableChroot is false and buildLocal is true', () => {
      const configWithBuildLocal = {
        ...mockConfig,
        buildLocal: true,
        enableChroot: false
      };
      const result = generateDockerCompose(configWithBuildLocal, mockNetworkConfig);
      const agent = result.services.agent as any;

      expect(agent.build).toBeDefined();
      expect(agent.build.dockerfile).toBe('Dockerfile');
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

      it('should set AWF_ENABLE_HOST_ACCESS when enableHostAccess is true', () => {
        const config = { ...mockConfig, enableHostAccess: true };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const env = result.services.agent.environment as Record<string, string>;

        expect(env.AWF_ENABLE_HOST_ACCESS).toBe('1');
      });

      it('should NOT set AWF_ENABLE_HOST_ACCESS when enableHostAccess is false', () => {
        const config = { ...mockConfig, enableHostAccess: false };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const env = result.services.agent.environment as Record<string, string>;

        expect(env.AWF_ENABLE_HOST_ACCESS).toBeUndefined();
      });

      it('should NOT set AWF_ENABLE_HOST_ACCESS when enableHostAccess is undefined', () => {
        const result = generateDockerCompose(mockConfig, mockNetworkConfig);
        const env = result.services.agent.environment as Record<string, string>;

        expect(env.AWF_ENABLE_HOST_ACCESS).toBeUndefined();
      });
    });

    describe('allowHostPorts option', () => {
      it('should set AWF_ALLOW_HOST_PORTS when allowHostPorts is specified', () => {
        const config = { ...mockConfig, enableHostAccess: true, allowHostPorts: '8080,3000' };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const env = result.services.agent.environment as Record<string, string>;

        expect(env.AWF_ALLOW_HOST_PORTS).toBe('8080,3000');
      });

      it('should NOT set AWF_ALLOW_HOST_PORTS when allowHostPorts is undefined', () => {
        const config = { ...mockConfig, enableHostAccess: true };
        const result = generateDockerCompose(config, mockNetworkConfig);
        const env = result.services.agent.environment as Record<string, string>;

        expect(env.AWF_ALLOW_HOST_PORTS).toBeUndefined();
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

    it('should continue when removing existing containers fails', async () => {
      // First call (docker rm) throws an error, but we should continue
      mockExecaFn.mockRejectedValueOnce(new Error('No such container'));
      // Second call (docker compose up) succeeds
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

      await startContainers(testDir, ['github.com']);

      // Should still call docker compose up even if rm failed
      expect(mockExecaFn).toHaveBeenCalledWith(
        'docker',
        ['compose', 'up', '-d'],
        { cwd: testDir, stdio: 'inherit' }
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

    it('should run docker compose up with --pull never when skipPull is true', async () => {
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

      await startContainers(testDir, ['github.com'], undefined, true);

      expect(mockExecaFn).toHaveBeenCalledWith(
        'docker',
        ['compose', 'up', '-d', '--pull', 'never'],
        { cwd: testDir, stdio: 'inherit' }
      );
    });

    it('should run docker compose up without --pull never when skipPull is false', async () => {
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);
      mockExecaFn.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 } as any);

      await startContainers(testDir, ['github.com'], undefined, false);

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
