/**
 * Command handler for `awf logs stats` subcommand
 */

import type { LogStatsFormat } from '../types';
import { formatStats } from '../logs/stats-formatter';
import {
  discoverAndSelectSource,
  loadLogsWithErrorHandling,
} from './logs-command-helpers';

/**
 * Output format type for stats command (alias for shared type)
 */
export type StatsFormat = LogStatsFormat;

/**
 * Options for the stats command
 */
export interface StatsCommandOptions {
  /** Output format: json, markdown, pretty */
  format: StatsFormat;
  /** Specific path to log directory or "running" for live container */
  source?: string;
}

/**
 * Main handler for the `awf logs stats` subcommand
 *
 * Loads logs from the specified source (or auto-discovered source),
 * aggregates statistics, and outputs in the requested format.
 *
 * @param options - Command options
 */
export async function statsCommand(options: StatsCommandOptions): Promise<void> {
  // Discover and select log source
  // For stats command: show info logs for all non-JSON formats
  const source = await discoverAndSelectSource(options.source, {
    format: options.format,
    shouldLog: (format) => format !== 'json',
  });

  // Load and aggregate logs
  const stats = await loadLogsWithErrorHandling(source);

  // Format and output
  const colorize = !!(process.stdout.isTTY && options.format === 'pretty');
  const output = formatStats(stats, options.format, colorize);
  console.log(output);
}
