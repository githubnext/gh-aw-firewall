import * as fs from 'fs/promises';
import * as path from 'path';

export interface SquidLogEntry {
  timestamp: number; // Unix timestamp with milliseconds
  clientIp: string;
  clientPort: number;
  host: string; // Domain from Host header or SNI
  destIp: string;
  destPort: number;
  protocol: string; // e.g., "HTTP/1.1", "HTTPS"
  method: string; // e.g., "GET", "CONNECT"
  statusCode: number; // 200=allowed, 403=blocked
  decision: string; // TCP_TUNNEL, TCP_DENIED, etc.
  hierarchy: string; // HIER_DIRECT, HIER_NONE, etc.
  url: string;
  userAgent: string;
  raw: string; // Original log line
}

export interface IptablesLogEntry {
  timestamp: string;
  prefix: string; // [FW_BLOCKED_UDP] or [FW_BLOCKED_OTHER]
  protocol: string;
  srcIp: string;
  srcPort?: number;
  dstIp: string;
  dstPort?: number;
  uid?: number; // Process UID
  raw: string; // Original log line
}

/**
 * Parser for Squid access logs and iptables kernel logs
 */
export class LogParser {
  /**
   * Parse Squid access.log with firewall_detailed format
   * Format: %ts.%03tu %>a:%>p %{Host}>h %<a:%<p %rv %rm %>Hs %Ss:%Sh %ru "%{User-Agent}>h"
   */
  parseSquidLog(logContent: string): SquidLogEntry[] {
    const entries: SquidLogEntry[] = [];
    const lines = logContent.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        // Parse fields (space-separated, except User-Agent in quotes)
        const parts = line.match(/(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]*)"/);

        if (!parts) {
          continue; // Skip malformed lines
        }

        const [, timestamp, clientAddr, host, destAddr, protocol, method, statusCode, decision, url, userAgent] = parts;

        // Parse client address (ip:port)
        const [clientIp, clientPort] = clientAddr.split(':');

        // Parse destination address (ip:port)
        const [destIp, destPort] = destAddr.split(':');

        // Parse decision code (format: "TCP_TUNNEL:HIER_DIRECT")
        const [decisionCode, hierarchy] = decision.split(':');

        entries.push({
          timestamp: parseFloat(timestamp),
          clientIp,
          clientPort: parseInt(clientPort, 10),
          host,
          destIp,
          destPort: parseInt(destPort, 10),
          protocol,
          method,
          statusCode: parseInt(statusCode, 10),
          decision: decisionCode,
          hierarchy,
          url,
          userAgent,
          raw: line,
        });
      } catch (error) {
        // Skip unparseable lines
        continue;
      }
    }

    return entries;
  }

  /**
   * Read and parse Squid access.log from a work directory
   */
  async readSquidLog(workDir: string): Promise<SquidLogEntry[]> {
    const logPath = path.join(workDir, 'squid-logs', 'access.log');

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      return this.parseSquidLog(content);
    } catch (error) {
      return []; // Log file may not exist
    }
  }

  /**
   * Parse iptables kernel log entries
   * Example: Jan 30 12:34:56 kernel: [FW_BLOCKED_UDP] IN=eth0 OUT= SRC=10.0.0.1 DST=8.8.8.8 PROTO=UDP SPT=12345 DPT=53 UID=1000
   */
  parseIptablesLog(logContent: string): IptablesLogEntry[] {
    const entries: IptablesLogEntry[] = [];
    const lines = logContent.trim().split('\n');

    for (const line of lines) {
      if (!line.includes('[FW_BLOCKED')) continue;

      try {
        // Extract prefix
        const prefixMatch = line.match(/\[(FW_BLOCKED_[A-Z]+)\]/);
        if (!prefixMatch) continue;
        const prefix = prefixMatch[1];

        // Extract fields
        const srcMatch = line.match(/SRC=([^\s]+)/);
        const dstMatch = line.match(/DST=([^\s]+)/);
        const protoMatch = line.match(/PROTO=([^\s]+)/);
        const sptMatch = line.match(/SPT=(\d+)/);
        const dptMatch = line.match(/DPT=(\d+)/);
        const uidMatch = line.match(/UID=(\d+)/);

        if (!srcMatch || !dstMatch || !protoMatch) continue;

        entries.push({
          timestamp: line.substring(0, 15), // "Jan 30 12:34:56"
          prefix,
          protocol: protoMatch[1],
          srcIp: srcMatch[1],
          srcPort: sptMatch ? parseInt(sptMatch[1], 10) : undefined,
          dstIp: dstMatch[1],
          dstPort: dptMatch ? parseInt(dptMatch[1], 10) : undefined,
          uid: uidMatch ? parseInt(uidMatch[1], 10) : undefined,
          raw: line,
        });
      } catch (error) {
        continue;
      }
    }

    return entries;
  }

  /**
   * Read iptables logs from kernel log (dmesg)
   */
  async readIptablesLog(): Promise<IptablesLogEntry[]> {
    const execa = require('execa');

    try {
      const { stdout } = await execa('dmesg');
      return this.parseIptablesLog(stdout);
    } catch (error) {
      return [];
    }
  }

  /**
   * Filter Squid log entries by decision (allowed/blocked)
   */
  filterByDecision(entries: SquidLogEntry[], decision: 'allowed' | 'blocked'): SquidLogEntry[] {
    if (decision === 'allowed') {
      return entries.filter(entry => entry.statusCode === 200 && entry.decision === 'TCP_TUNNEL');
    } else {
      return entries.filter(entry => entry.statusCode === 403 && entry.decision === 'TCP_DENIED');
    }
  }

  /**
   * Filter Squid log entries by domain
   */
  filterByDomain(entries: SquidLogEntry[], domain: string): SquidLogEntry[] {
    const normalizedDomain = domain.toLowerCase();
    return entries.filter(entry =>
      entry.host.toLowerCase() === normalizedDomain ||
      entry.host.toLowerCase().endsWith(`.${normalizedDomain}`)
    );
  }

  /**
   * Get unique domains from Squid log entries
   */
  getUniqueDomains(entries: SquidLogEntry[]): string[] {
    const domains = new Set<string>();
    for (const entry of entries) {
      domains.add(entry.host);
    }
    return Array.from(domains).sort();
  }

  /**
   * Check if a domain was allowed in Squid logs
   */
  wasAllowed(entries: SquidLogEntry[], domain: string): boolean {
    const domainEntries = this.filterByDomain(entries, domain);
    const allowed = this.filterByDecision(domainEntries, 'allowed');
    return allowed.length > 0;
  }

  /**
   * Check if a domain was blocked in Squid logs
   */
  wasBlocked(entries: SquidLogEntry[], domain: string): boolean {
    const domainEntries = this.filterByDomain(entries, domain);
    const blocked = this.filterByDecision(domainEntries, 'blocked');
    return blocked.length > 0;
  }
}

/**
 * Convenience function for creating a LogParser
 */
export function createLogParser(): LogParser {
  return new LogParser();
}
