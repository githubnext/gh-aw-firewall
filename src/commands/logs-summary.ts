/**
 * Command handler for `awf logs summary` subcommand
 *
 * This command is designed specifically for generating GitHub Actions step summaries.
 * It defaults to markdown output format for easy piping to $GITHUB_STEP_SUMMARY.
 */

import type { LogStatsFormat } from '../types';
import { formatStats } from '../logs/stats-formatter';
import {
  discoverAndSelectSource,
  loadLogsWithErrorHandling,
} from './logs-command-helpers';

/**
 * Output format type for summary command (alias for shared type)
 */
export type SummaryFormat = LogStatsFormat;

/**
 * Options for the summary command
 */
export interface SummaryCommandOptions {
  /** Output format: json, markdown, pretty (default: markdown) */
  format: SummaryFormat;
  /** Specific path to log directory or "running" for live container */
  source?: string;
}

/**
 * Main handler for the `awf logs summary` subcommand
 *
 * Loads logs from the specified source (or auto-discovered source),
 * aggregates statistics, and outputs a summary in the requested format.
 *
 * Designed for GitHub Actions:
 * ```bash
 * awf logs summary >> $GITHUB_STEP_SUMMARY
 * ```
 *
 * @param options - Command options
 */
export async function summaryCommand(options: SummaryCommandOptions): Promise<void> {
  // Discover and select log source
  // For summary command: only show info logs in pretty format
  // This differs intentionally from `logs-stats` which logs for all non-JSON formats.
  // The stricter approach here keeps markdown output (the default, intended for
  // GitHub Actions step summaries) free of extra lines that would pollute $GITHUB_STEP_SUMMARY.
  const source = await discoverAndSelectSource(options.source, {
    format: options.format,
    shouldLog: (format) => format === 'pretty',
  });

  // Load and aggregate logs
  const stats = await loadLogsWithErrorHandling(source);

  // Format and output
  const colorize = !!(process.stdout.isTTY && options.format === 'pretty');
  const output = formatStats(stats, options.format, colorize);
  console.log(output);
}
