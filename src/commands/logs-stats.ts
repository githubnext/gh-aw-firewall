/**
 * Command handler for `awf logs stats` subcommand
 */

import { logger } from '../logger';
import {
  discoverLogSources,
  selectMostRecent,
  validateSource,
} from '../logs/log-discovery';
import { loadAndAggregate } from '../logs/log-aggregator';
import { formatStats } from '../logs/stats-formatter';

/**
 * Output format type for stats command
 */
export type StatsFormat = 'json' | 'markdown' | 'pretty';

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
  // Discover log sources
  const sources = await discoverLogSources();

  // Determine which source to use
  let source;
  if (options.source) {
    // User specified a source
    try {
      source = await validateSource(options.source);
      logger.debug(`Using specified source: ${options.source}`);
    } catch (error) {
      logger.error(
        `Invalid log source: ${error instanceof Error ? error.message : error}`
      );
      process.exit(1);
    }
  } else if (sources.length === 0) {
    logger.error('No log sources found. Run awf with a command first to generate logs.');
    process.exit(1);
  } else {
    // Select most recent source
    source = selectMostRecent(sources);
    if (!source) {
      logger.error('No log sources found.');
      process.exit(1);
    }

    // Log which source we're using (only for non-json output to avoid polluting json)
    if (options.format !== 'json') {
      if (source.type === 'running') {
        logger.info(`Using live logs from running container: ${source.containerName}`);
      } else {
        logger.info(`Using preserved logs from: ${source.path}`);
        if (source.dateStr) {
          logger.info(`Log timestamp: ${source.dateStr}`);
        }
      }
    }
  }

  // Load and aggregate logs
  try {
    const stats = await loadAndAggregate(source);

    // Format and output
    const colorize = !!(process.stdout.isTTY && options.format === 'pretty');
    const output = formatStats(stats, options.format, colorize);
    console.log(output);
  } catch (error) {
    logger.error(`Failed to load logs: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
