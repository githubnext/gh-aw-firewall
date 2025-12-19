/**
 * Log aggregation module for computing statistics from parsed log entries
 */

import * as fs from 'fs';
import * as path from 'path';
import execa from 'execa';
import { LogSource, ParsedLogEntry } from '../types';
import { parseLogLine } from './log-parser';
import { logger } from '../logger';

/**
 * Statistics for a single domain
 */
export interface DomainStats {
  /** Domain name */
  domain: string;
  /** Number of allowed requests */
  allowed: number;
  /** Number of denied requests */
  denied: number;
  /** Total number of requests */
  total: number;
}

/**
 * Aggregated statistics from log entries
 */
export interface AggregatedStats {
  /** Total number of requests */
  totalRequests: number;
  /** Number of allowed requests */
  allowedRequests: number;
  /** Number of denied requests */
  deniedRequests: number;
  /** Number of unique domains */
  uniqueDomains: number;
  /** Statistics grouped by domain */
  byDomain: Map<string, DomainStats>;
  /** Time range of the logs (null if no entries) */
  timeRange: { start: number; end: number } | null;
}

/**
 * Aggregates parsed log entries into statistics
 *
 * @param entries - Array of parsed log entries
 * @returns Aggregated statistics
 */
export function aggregateLogs(entries: ParsedLogEntry[]): AggregatedStats {
  const byDomain = new Map<string, DomainStats>();
  let allowedRequests = 0;
  let deniedRequests = 0;
  let minTimestamp = Infinity;
  let maxTimestamp = -Infinity;

  for (const entry of entries) {
    // Track time range
    if (entry.timestamp < minTimestamp) {
      minTimestamp = entry.timestamp;
    }
    if (entry.timestamp > maxTimestamp) {
      maxTimestamp = entry.timestamp;
    }

    // Count allowed/denied
    if (entry.isAllowed) {
      allowedRequests++;
    } else {
      deniedRequests++;
    }

    // Group by domain
    const domain = entry.domain || '-';
    let domainStats = byDomain.get(domain);
    if (!domainStats) {
      domainStats = {
        domain,
        allowed: 0,
        denied: 0,
        total: 0,
      };
      byDomain.set(domain, domainStats);
    }

    domainStats.total++;
    if (entry.isAllowed) {
      domainStats.allowed++;
    } else {
      domainStats.denied++;
    }
  }

  const totalRequests = entries.length;
  const uniqueDomains = byDomain.size;
  const timeRange =
    entries.length > 0 ? { start: minTimestamp, end: maxTimestamp } : null;

  return {
    totalRequests,
    allowedRequests,
    deniedRequests,
    uniqueDomains,
    byDomain,
    timeRange,
  };
}

/**
 * Loads all log entries from a source
 *
 * @param source - Log source (running container or preserved file)
 * @returns Array of parsed log entries
 */
export async function loadAllLogs(source: LogSource): Promise<ParsedLogEntry[]> {
  let content: string;

  if (source.type === 'running') {
    // Read from running container
    logger.debug(`Loading logs from container: ${source.containerName}`);
    try {
      const result = await execa('docker', [
        'exec',
        source.containerName!,
        'cat',
        '/var/log/squid/access.log',
      ]);
      content = result.stdout;
    } catch (error) {
      logger.debug(`Failed to read from container: ${error}`);
      return [];
    }
  } else {
    // Read from file
    const filePath = path.join(source.path!, 'access.log');
    logger.debug(`Loading logs from file: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      logger.debug(`Log file not found: ${filePath}`);
      return [];
    }

    content = fs.readFileSync(filePath, 'utf-8');
  }

  // Parse all lines
  const entries: ParsedLogEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const entry = parseLogLine(trimmed);
    if (entry) {
      entries.push(entry);
    } else {
      logger.debug(`Failed to parse log line: ${trimmed}`);
    }
  }

  return entries;
}

/**
 * Loads logs from a source and aggregates them into statistics
 *
 * @param source - Log source
 * @returns Aggregated statistics
 */
export async function loadAndAggregate(source: LogSource): Promise<AggregatedStats> {
  const entries = await loadAllLogs(source);
  return aggregateLogs(entries);
}
