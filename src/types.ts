/**
 * Configuration types for the firewall wrapper
 */

export interface WrapperConfig {
  allowedDomains: string[];
  copilotCommand: string;
  logLevel: LogLevel;
  keepContainers: boolean;
  workDir: string;
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
  driver: string;
  ipam?: {
    config: Array<{ subnet: string }>;
  };
}
