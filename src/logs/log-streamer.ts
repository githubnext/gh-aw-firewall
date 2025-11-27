/**
 * Log streaming module for reading logs from containers or files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import execa from 'execa';
import { LogSource } from '../types';
import { LogFormatter } from './log-formatter';
import { parseLogLine } from './log-parser';
import { logger } from '../logger';

/**
 * Options for streaming logs
 */
export interface StreamOptions {
  /** Follow log output in real-time (like tail -f) */
  follow: boolean;
  /** Log source to stream from */
  source: LogSource;
  /** Formatter for output */
  formatter: LogFormatter;
  /** Whether to parse logs (false for raw format) */
  parse?: boolean;
}

/**
 * Streams logs from a source to stdout
 *
 * @param options - Streaming options
 */
export async function streamLogs(options: StreamOptions): Promise<void> {
  const { follow, source, formatter, parse = true } = options;

  if (source.type === 'running') {
    await streamFromContainer(source.containerName!, follow, formatter, parse);
  } else {
    await streamFromFile(source.path!, follow, formatter, parse);
  }
}

/**
 * Streams logs from a running Docker container
 */
async function streamFromContainer(
  containerName: string,
  follow: boolean,
  formatter: LogFormatter,
  parse: boolean
): Promise<void> {
  logger.debug(`Streaming logs from container: ${containerName}`);

  // Use docker exec to read logs from within the container
  const args = follow
    ? ['exec', containerName, 'tail', '-f', '/var/log/squid/access.log']
    : ['exec', containerName, 'cat', '/var/log/squid/access.log'];

  const proc = execa('docker', args, {
    reject: false,
  });

  // Setup cleanup on process exit
  const cleanup = () => {
    proc.kill('SIGTERM');
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // Process stdout line-by-line
    if (proc.stdout) {
      const rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        processLine(line, formatter, parse);
      }
    }

    await proc;
  } catch (error) {
    // Ignore SIGTERM errors (normal termination)
    if (error instanceof Error && 'signal' in error && error.signal === 'SIGTERM') {
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }
}

/**
 * Streams logs from a preserved log file
 */
async function streamFromFile(
  logDir: string,
  follow: boolean,
  formatter: LogFormatter,
  parse: boolean
): Promise<void> {
  const filePath = path.join(logDir, 'access.log');

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Log file not found: ${filePath}`);
  }

  logger.debug(`Reading logs from file: ${filePath}`);

  if (follow) {
    // Use tail -f for live following
    await tailFile(filePath, formatter, parse);
  } else {
    // Read entire file at once
    await readFile(filePath, formatter, parse);
  }
}

/**
 * Reads an entire log file
 */
async function readFile(
  filePath: string,
  formatter: LogFormatter,
  parse: boolean
): Promise<void> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim() === '') continue;
    processLine(line, formatter, parse);
  }
}

/**
 * Follows a log file using tail -f
 */
async function tailFile(
  filePath: string,
  formatter: LogFormatter,
  parse: boolean
): Promise<void> {
  const proc = execa('tail', ['-f', filePath], {
    reject: false,
  });

  const cleanup = () => {
    proc.kill('SIGTERM');
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    if (proc.stdout) {
      const rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        processLine(line, formatter, parse);
      }
    }

    await proc;
  } catch (error) {
    if (error instanceof Error && 'signal' in error && error.signal === 'SIGTERM') {
      return;
    }
    throw error;
  } finally {
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }
}

/**
 * Processes a single log line - parses (if enabled) and outputs
 */
function processLine(line: string, formatter: LogFormatter, parse: boolean): void {
  if (!parse) {
    // Raw format - output as-is
    process.stdout.write(formatter.formatRaw(line));
    return;
  }

  // Parse and format
  const entry = parseLogLine(line);
  if (entry) {
    process.stdout.write(formatter.formatEntry(entry));
  } else {
    // Failed to parse, output as raw with a warning indicator
    logger.debug(`Failed to parse log line: ${line}`);
    process.stdout.write(formatter.formatRaw(line));
  }
}
