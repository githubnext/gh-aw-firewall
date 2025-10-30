import execa = require('execa');
import * as path from 'path';

type ExecaReturnValue = execa.ExecaReturnValue<string>;

export interface AwfOptions {
  allowDomains?: string[];
  keepContainers?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  buildLocal?: boolean;
  imageRegistry?: string;
  imageTag?: string;
  timeout?: number; // milliseconds
  env?: Record<string, string>;
}

export interface AwfResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
  timedOut: boolean;
  workDir?: string; // Extracted from stderr logs
}

/**
 * Helper class for running awf commands in tests
 */
export class AwfRunner {
  private awfPath: string;

  constructor(awfPath?: string) {
    // Default to the built CLI in dist/cli.js
    this.awfPath = awfPath || path.resolve(__dirname, '../../dist/cli.js');
  }

  /**
   * Run an awf command
   */
  async run(command: string, options: AwfOptions = {}): Promise<AwfResult> {
    const args: string[] = [];

    // Add allow-domains
    if (options.allowDomains && options.allowDomains.length > 0) {
      args.push('--allow-domains', options.allowDomains.join(','));
    }

    // Add other flags
    if (options.keepContainers) {
      args.push('--keep-containers');
    }

    if (options.logLevel) {
      args.push('--log-level', options.logLevel);
    }

    if (options.buildLocal) {
      args.push('--build-local');
    }

    if (options.imageRegistry) {
      args.push('--image-registry', options.imageRegistry);
    }

    if (options.imageTag) {
      args.push('--image-tag', options.imageTag);
    }

    // Add the command to execute
    args.push(command);

    const execOptions = {
      reject: false, // Don't throw on non-zero exit
      all: true,
      timeout: options.timeout || 120000, // Default 2 minutes
      env: {
        ...process.env,
        ...options.env,
      },
    };

    let result: ExecaReturnValue;

    try {
      result = await execa('node', [this.awfPath, ...args], execOptions);
    } catch (error: any) {
      // Handle timeout
      if (error.timedOut) {
        return {
          exitCode: -1,
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          success: false,
          timedOut: true,
        };
      }
      throw error;
    }

    // Extract work directory from stderr logs
    const workDir = this.extractWorkDir(result.stderr || '');

    return {
      exitCode: result.exitCode || 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      success: result.exitCode === 0,
      timedOut: false,
      workDir,
    };
  }

  /**
   * Run awf with sudo (required for iptables manipulation)
   */
  async runWithSudo(command: string, options: AwfOptions = {}): Promise<AwfResult> {
    const args: string[] = [];

    // Preserve environment variables
    args.push('-E');

    // Add awf path
    args.push('node', this.awfPath);

    // Add allow-domains
    if (options.allowDomains && options.allowDomains.length > 0) {
      args.push('--allow-domains', options.allowDomains.join(','));
    }

    // Add other flags
    if (options.keepContainers) {
      args.push('--keep-containers');
    }

    if (options.logLevel) {
      args.push('--log-level', options.logLevel);
    }

    if (options.buildLocal) {
      args.push('--build-local');
    }

    if (options.imageRegistry) {
      args.push('--image-registry', options.imageRegistry);
    }

    if (options.imageTag) {
      args.push('--image-tag', options.imageTag);
    }

    // Add the command to execute
    args.push(command);

    const execOptions = {
      reject: false,
      all: true,
      timeout: options.timeout || 120000,
      env: {
        ...process.env,
        ...options.env,
      },
    };

    let result: ExecaReturnValue;

    try {
      result = await execa('sudo', args, execOptions);
    } catch (error: any) {
      if (error.timedOut) {
        return {
          exitCode: -1,
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          success: false,
          timedOut: true,
        };
      }
      throw error;
    }

    const workDir = this.extractWorkDir(result.stderr || '');

    return {
      exitCode: result.exitCode || 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      success: result.exitCode === 0,
      timedOut: false,
      workDir,
    };
  }

  /**
   * Extract work directory from awf stderr logs
   * Looks for patterns like "[INFO] Using work directory: /tmp/awf-1234567890"
   */
  private extractWorkDir(stderr: string): string | undefined {
    const match = stderr.match(/Using work directory: (\/tmp\/awf-\d+)/);
    return match ? match[1] : undefined;
  }
}

/**
 * Convenience function for creating an AwfRunner
 */
export function createRunner(awfPath?: string): AwfRunner {
  return new AwfRunner(awfPath);
}
