/**
 * Configuration types for the firewall
 */

export interface WrapperConfig {
  allowedDomains: string[];
  agentCommand: string;
  logLevel: LogLevel;
  keepContainers: boolean;
  workDir: string;
  imageRegistry?: string;  // Default: 'ghcr.io/githubnext/gh-aw-firewall'
  imageTag?: string;       // Default: 'latest'
  buildLocal?: boolean;    // Default: false (use GHCR images)
  additionalEnv?: Record<string, string>; // Additional environment variables to pass to container
  envAll?: boolean;        // Pass all host environment variables (excluding system vars)
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SquidConfig {
  domains: string[];
  port: number;
}

export interface DockerComposeConfig {
  version?: string;
  services: {
    [key: string]: DockerService;
  };
  networks: {
    [key: string]: DockerNetwork;
  };
  volumes?: {
    [key: string]: Record<string, unknown>;
  };
}

export interface DockerService {
  image?: string;
  build?: {
    context: string;
    dockerfile: string;
  };
  container_name: string;
  networks: string[] | { [key: string]: { ipv4_address?: string } };
  dns?: string[];
  dns_search?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  depends_on?: string[] | { [key: string]: { condition: string } };
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period?: string;
  };
  cap_add?: string[];
  stdin_open?: boolean;
  tty?: boolean;
  command?: string[];
  ports?: string[];
}

export interface DockerNetwork {
  driver?: string;
  ipam?: {
    config: Array<{ subnet: string }>;
  };
  external?: boolean;
}

export interface BlockedTarget {
  target: string; // Full target including port (e.g., "github.com:8443")
  domain: string; // Domain without port (e.g., "github.com")
  port?: string;  // Port number if present (e.g., "8443")
}
