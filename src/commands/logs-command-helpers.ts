/**
 * Shared helper functions for log commands (stats and summary)
 */

import { logger } from '../logger';
import type { LogSource } from '../types';
import {
  discoverLogSources,
  selectMostRecent,
  validateSource,
} from '../logs/log-discovery';
import { loadAndAggregate } from '../logs/log-aggregator';
import type { AggregatedStats } from '../logs/log-aggregator';

/**
 * Options for determining which logs to show (based on log level)
 */
export interface LoggingOptions {
  /** The output format being used */
  format: string;
  /** Callback to determine if info logs should be shown */
  shouldLog: (format: string) => boolean;
}

/**
 * Discovers and selects a log source based on user input or auto-discovery.
 * Handles validation, error messages, and optional logging.
 *
 * @param sourceOption - User-specified source path or "running", or undefined for auto-discovery
 * @param loggingOptions - Options controlling when to emit log messages
 * @returns Selected log source
 */
export async function discoverAndSelectSource(
  sourceOption: string | undefined,
  loggingOptions: LoggingOptions
): Promise<LogSource> {
  // Discover log sources
  const sources = await discoverLogSources();

  // Determine which source to use
  let source: LogSource;
  
  if (sourceOption) {
    // User specified a source
    try {
      source = await validateSource(sourceOption);
      logger.debug(`Using specified source: ${sourceOption}`);
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
    const selected = selectMostRecent(sources);
    if (!selected) {
      logger.error('No log sources found.');
      process.exit(1);
    }
    source = selected;

    // Log which source we're using (conditionally based on format)
    if (loggingOptions.shouldLog(loggingOptions.format)) {
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

  return source;
}

/**
 * Loads and aggregates logs from a source, handling errors gracefully.
 *
 * @param source - Log source to load from
 * @returns Aggregated statistics
 */
export async function loadLogsWithErrorHandling(
  source: LogSource
): Promise<AggregatedStats> {
  try {
    return await loadAndAggregate(source);
  } catch (error) {
    logger.error(`Failed to load logs: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
