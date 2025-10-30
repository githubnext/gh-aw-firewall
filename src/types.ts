/**
 * Configuration types for the agentic workflow firewall
 */

/**
 * Main configuration interface for the firewall wrapper
 * 
 * This configuration controls the entire firewall lifecycle including:
 * - Domain whitelisting for egress traffic control
 * - Container orchestration via Docker Compose
 * - Logging behavior and debugging options
 * - Container image sources (GHCR vs local builds)
 * - Environment variable propagation to containers
 * 
 * @example
 * ```typescript
 * const config: WrapperConfig = {
 *   allowedDomains: ['github.com', 'api.github.com'],
 *   copilotCommand: 'npx @github/copilot --prompt "test"',
 *   logLevel: 'info',
 *   keepContainers: false,
 *   workDir: '/tmp/awf-1234567890',
 * };
 * ```
 */
export interface WrapperConfig {
  /**
   * List of allowed domains for HTTP/HTTPS egress traffic
   * 
   * Domains are normalized (protocol and trailing slash removed) and automatically
   * include subdomain matching. For example, 'github.com' will also allow
   * 'api.github.com' and 'raw.githubusercontent.com'.
   * 
   * @example ['github.com', 'googleapis.com', 'arxiv.org']
   */
  allowedDomains: string[];

  /**
   * The command to execute inside the firewall container
   * 
   * This command runs inside an Ubuntu-based Docker container with iptables rules
   * that redirect all HTTP/HTTPS traffic through a Squid proxy. The command has
   * access to the host filesystem (mounted at /host and ~) and Docker socket.
   * 
   * @example 'npx @github/copilot --prompt "list files"'
   * @example 'curl https://api.github.com/zen'
   */
  copilotCommand: string;

  /**
   * Logging verbosity level
   * 
   * Controls which log messages are displayed:
   * - 'debug': All messages including detailed diagnostics
   * - 'info': Informational messages and above
   * - 'warn': Warnings and errors only
   * - 'error': Errors only
   */
  logLevel: LogLevel;

  /**
   * Whether to preserve containers and configuration files after execution
   * 
   * When true:
   * - Docker containers are not stopped or removed
   * - Work directory and all config files remain on disk
   * - Useful for debugging, inspecting logs, and troubleshooting
   * 
   * When false (default):
   * - Containers are stopped and removed via 'docker compose down -v'
   * - Work directory is deleted (except preserved log directories)
   * - Squid and Copilot logs are moved to /tmp if they exist
   */
  keepContainers: boolean;

  /**
   * Temporary work directory for configuration files and logs
   * 
   * This directory contains:
   * - squid.conf: Generated Squid proxy configuration
   * - docker-compose.yml: Docker Compose service definitions
   * - copilot-logs/: Volume mount for Copilot CLI logs
   * - squid-logs/: Volume mount for Squid proxy logs
   * 
   * @example '/tmp/awf-1234567890'
   */
  workDir: string;

  /**
   * Docker image registry to use for container images
   * 
   * Allows overriding the default GitHub Container Registry with custom registries
   * for development, testing, or air-gapped environments.
   * 
   * @default 'ghcr.io/githubnext/gh-aw-firewall'
   * @example 'my-registry.example.com/awf'
   */
  imageRegistry?: string;

  /**
   * Docker image tag to use for container images
   * 
   * @default 'latest'
   * @example 'v0.1.0'
   * @example 'dev'
   */
  imageTag?: string;

  /**
   * Whether to build container images locally instead of pulling from registry
   * 
   * When true, Docker images are built from local Dockerfiles in containers/squid
   * and containers/copilot directories. When false (default), images are pulled
   * from the configured registry.
   * 
   * @default false
   */
  buildLocal?: boolean;

  /**
   * Additional environment variables to pass to the copilot container
   * 
   * These variables are explicitly passed to the container and are accessible
   * to the command and any MCP servers. Common use cases include API tokens,
   * configuration values, and credentials.
   * 
   * @example { GITHUB_TOKEN: 'ghp_...', OPENAI_API_KEY: 'sk-...' }
   */
  additionalEnv?: Record<string, string>;

  /**
   * Whether to pass all host environment variables to the container
   * 
   * When true, all environment variables from the host (excluding system variables
   * like PATH, HOME, etc.) are passed to the copilot container. This is useful for
   * development but may pose security risks in production.
   * 
   * When false (default), only variables specified in additionalEnv are passed.
   * 
   * @default false
   */
  envAll?: boolean;
}

/**
 * Logging level type for controlling output verbosity
 * 
 * The logger filters messages based on this level.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Configuration for the Squid proxy server
 * 
 * Used to generate squid.conf with domain-based access control lists (ACLs).
 * The generated configuration implements L7 (application layer) filtering for
 * HTTP and HTTPS traffic using domain whitelisting.
 */
export interface SquidConfig {
  /**
   * List of allowed domains for proxy access
   * 
   * These domains are converted to Squid ACL rules with subdomain matching.
   * For example, 'github.com' becomes '.github.com' in Squid configuration,
   * which matches both 'github.com' and all subdomains like 'api.github.com'.
   */
  domains: string[];

  /**
   * Port number for the Squid proxy to listen on
   * 
   * The proxy listens on this port within the Docker network for HTTP
   * and HTTPS (CONNECT method) requests.
   * 
   * @default 3128
   */
  port: number;
}

/**
 * Docker Compose configuration structure
 * 
 * Represents the structure of a docker-compose.yml file used to orchestrate
 * the Squid proxy container and Copilot execution container. This configuration
 * is generated dynamically and written to the work directory.
 * 
 * The typical setup includes:
 * - A Squid proxy service for traffic filtering
 * - A Copilot service for command execution with iptables NAT rules
 * - A custom Docker network with fixed IP assignments
 * - Named volumes for log persistence
 */
export interface DockerComposeConfig {
  /**
   * Docker Compose file version
   * 
   * @deprecated Version specification is optional in modern Docker Compose
   */
  version?: string;

  /**
   * Service definitions (containers)
   * 
   * Typically includes two services:
   * - 'squid-proxy': Squid proxy server for traffic filtering
   * - 'copilot': Ubuntu container for command execution with iptables
   * 
   * @example { 'squid-proxy': {...}, 'copilot': {...} }
   */
  services: {
    [key: string]: DockerService;
  };

  /**
   * Network definitions
   * 
   * Defines the Docker network topology. The firewall uses either:
   * - An external network 'awf-net' (when using host-iptables enforcement)
   * - A custom network with fixed subnet and IP assignments
   * 
   * @example { 'awf-net': { external: true } }
   */
  networks: {
    [key: string]: DockerNetwork;
  };

  /**
   * Named volume definitions
   * 
   * Optional volume definitions for persistent storage. Used for Squid
   * cache or log volumes when needed.
   * 
   * @example { 'squid-logs': {} }
   */
  volumes?: {
    [key: string]: Record<string, unknown>;
  };
}

/**
 * Docker service (container) configuration
 * 
 * Represents a single service in docker-compose.yml with all possible
 * configuration options used by the firewall. Services can be built locally
 * or pulled from a registry, and can have complex networking, volume mounting,
 * and dependency configurations.
 */
export interface DockerService {
  /**
   * Pre-built Docker image to use
   * 
   * Mutually exclusive with 'build'. When specified, the image is pulled
   * from the registry (local or remote).
   * 
   * @example 'ubuntu/squid:latest'
   * @example 'ghcr.io/githubnext/gh-aw-firewall/copilot:latest'
   */
  image?: string;

  /**
   * Build configuration for building images locally
   * 
   * Mutually exclusive with 'image'. When specified, Docker builds the
   * image from a Dockerfile in the given context directory.
   * 
   * @example { context: './containers/squid', dockerfile: 'Dockerfile' }
   */
  build?: {
    /** Directory containing the Dockerfile and build context */
    context: string;
    /** Path to the Dockerfile relative to context */
    dockerfile: string;
  };

  /**
   * Container name for the service
   * 
   * Used for container identification, logging, and inter-container communication.
   * The firewall typically uses 'awf-squid' and 'awf-copilot'.
   * 
   * @example 'awf-squid'
   * @example 'awf-copilot'
   */
  container_name: string;

  /**
   * Network configuration for the container
   * 
   * Can be either:
   * - Simple array: ['awf-net'] - Connect to named networks
   * - Object with IPs: { 'awf-net': { ipv4_address: '172.30.0.10' } } - Static IPs
   * 
   * Static IPs are used to ensure predictable addressing for iptables rules.
   * 
   * @example ['awf-net']
   * @example { 'awf-net': { ipv4_address: '172.30.0.10' } }
   */
  networks: string[] | { [key: string]: { ipv4_address?: string } };

  /**
   * Custom DNS servers for the container
   * 
   * Overrides the default Docker DNS. The firewall uses Google's public DNS
   * (8.8.8.8, 8.8.4.4) to ensure reliable name resolution.
   * 
   * @example ['8.8.8.8', '8.8.4.4']
   */
  dns?: string[];

  /**
   * DNS search domains for the container
   * 
   * Appended to unqualified hostnames during DNS resolution.
   */
  dns_search?: string[];

  /**
   * Volume mount specifications
   * 
   * Array of mount specifications in Docker format:
   * - Bind mounts: '/host/path:/container/path:options'
   * - Named volumes: 'volume-name:/container/path:options'
   * 
   * Common mounts:
   * - Host filesystem: '/:/host:ro' (read-only host access)
   * - Home directory: '${HOME}:${HOME}' (user files)
   * - Docker socket: '/var/run/docker.sock:/var/run/docker.sock' (docker-in-docker)
   * - Configs: '${workDir}/squid.conf:/etc/squid/squid.conf:ro'
   * 
   * @example ['./squid.conf:/etc/squid/squid.conf:ro']
   */
  volumes?: string[];

  /**
   * Environment variables for the container
   * 
   * Key-value pairs of environment variables. Values can include variable
   * substitutions (e.g., ${HOME}) which are resolved by Docker Compose.
   * 
   * @example { HTTP_PROXY: 'http://172.30.0.10:3128', GITHUB_TOKEN: '${GITHUB_TOKEN}' }
   */
  environment?: Record<string, string>;

  /**
   * Service dependencies
   * 
   * Can be either:
   * - Simple array: ['squid-proxy'] - Wait for service to start
   * - Object with conditions: { 'squid-proxy': { condition: 'service_healthy' } }
   * 
   * The copilot service typically depends on squid being healthy before starting.
   * 
   * @example ['squid-proxy']
   * @example { 'squid-proxy': { condition: 'service_healthy' } }
   */
  depends_on?: string[] | { [key: string]: { condition: string } };

  /**
   * Container health check configuration
   * 
   * Defines how Docker monitors container health. The Squid service uses
   * health checks to ensure the proxy is ready before starting the copilot container.
   * 
   * @example
   * ```typescript
   * {
   *   test: ['CMD', 'squidclient', '-h', 'localhost', '-p', '3128', 'http://localhost/'],
   *   interval: '5s',
   *   timeout: '3s',
   *   retries: 3,
   *   start_period: '10s'
   * }
   * ```
   */
  healthcheck?: {
    /** Command to run for health check (exit 0 = healthy) */
    test: string[];
    /** Time between health checks */
    interval: string;
    /** Max time to wait for a health check */
    timeout: string;
    /** Number of consecutive failures before unhealthy */
    retries: number;
    /** Grace period before health checks start */
    start_period?: string;
  };

  /**
   * Linux capabilities to add to the container
   * 
   * Grants additional privileges beyond the default container capabilities.
   * The copilot container requires NET_ADMIN for iptables manipulation.
   * 
   * @example ['NET_ADMIN']
   */
  cap_add?: string[];

  /**
   * Keep STDIN open even if not attached
   * 
   * Required for containers that need to read from stdin, such as MCP servers
   * that use stdio transport.
   * 
   * @default false
   */
  stdin_open?: boolean;

  /**
   * Allocate a pseudo-TTY
   * 
   * When false, prevents ANSI escape sequences in output, providing cleaner logs.
   * The firewall sets this to false for better log readability.
   * 
   * @default false
   */
  tty?: boolean;

  /**
   * Command to run in the container
   * 
   * Overrides the CMD from the Dockerfile. Array format is preferred to avoid
   * shell parsing issues.
   * 
   * @example ['sh', '-c', 'echo hello']
   */
  command?: string[];

  /**
   * Port mappings from host to container
   * 
   * Array of port mappings in format 'host:container' or 'host:container/protocol'.
   * The firewall typically doesn't expose ports as communication happens over
   * the Docker network.
   * 
   * @example ['8080:80', '443:443/tcp']
   */
  ports?: string[];
}

/**
 * Docker network configuration
 * 
 * Defines a custom Docker network or references an external network.
 * The firewall uses networks to isolate container communication and assign
 * static IP addresses for predictable iptables rules.
 */
export interface DockerNetwork {
  /**
   * Network driver to use
   * 
   * The 'bridge' driver creates a private network on the host.
   * 
   * @default 'bridge'
   * @example 'bridge'
   */
  driver?: string;

  /**
   * IP Address Management (IPAM) configuration
   * 
   * Defines the network's IP address range and gateway. Used to create
   * networks with specific subnets for avoiding conflicts with existing
   * Docker networks.
   * 
   * @example { config: [{ subnet: '172.30.0.0/24' }] }
   */
  ipam?: {
    /** Array of subnet configurations */
    config: Array<{ subnet: string }>;
  };

  /**
   * Whether this network is externally managed
   * 
   * When true, Docker Compose will not create or delete the network,
   * assuming it already exists. Used when the network is created by
   * host-iptables setup before running Docker Compose.
   * 
   * @default false
   */
  external?: boolean;
}

/**
 * Information about a blocked network target
 * 
 * Represents a domain and optional port that was blocked by the firewall.
 * Used for error reporting and diagnostics when egress traffic is denied.
 * Parsed from Squid proxy access logs (TCP_DENIED entries).
 */
export interface BlockedTarget {
  /**
   * Full target specification including port if present
   * 
   * @example 'github.com:8443'
   * @example 'example.com'
   */
  target: string;

  /**
   * Domain name without port
   * 
   * Extracted from the target for matching against the allowed domains list.
   * 
   * @example 'github.com'
   * @example 'example.com'
   */
  domain: string;

  /**
   * Port number if specified in the blocked request
   * 
   * Non-standard ports (other than 80/443) that were part of the connection attempt.
   * 
   * @example '8443'
   * @example '8080'
   */
  port?: string;
}
