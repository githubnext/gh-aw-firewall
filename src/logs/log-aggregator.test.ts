/**
 * Tests for log-aggregator module
 */

import { aggregateLogs, loadAllLogs, loadAndAggregate } from './log-aggregator';
import { ParsedLogEntry, LogSource } from '../types';
import execa from 'execa';
import * as fs from 'fs';

// Mock dependencies
jest.mock('execa');
jest.mock('fs');
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedExeca = execa as jest.MockedFunction<typeof execa>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('log-aggregator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('aggregateLogs', () => {
    it('should return empty stats for empty array', () => {
      const stats = aggregateLogs([]);

      expect(stats.totalRequests).toBe(0);
      expect(stats.allowedRequests).toBe(0);
      expect(stats.deniedRequests).toBe(0);
      expect(stats.uniqueDomains).toBe(0);
      expect(stats.byDomain.size).toBe(0);
      expect(stats.timeRange).toBeNull();
    });

    it('should count allowed and denied requests correctly', () => {
      const entries: ParsedLogEntry[] = [
        createLogEntry({ domain: 'github.com', isAllowed: true }),
        createLogEntry({ domain: 'github.com', isAllowed: true }),
        createLogEntry({ domain: 'evil.com', isAllowed: false }),
      ];

      const stats = aggregateLogs(entries);

      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBe(2);
      expect(stats.deniedRequests).toBe(1);
    });

    it('should group by domain correctly', () => {
      const entries: ParsedLogEntry[] = [
        createLogEntry({ domain: 'github.com', isAllowed: true }),
        createLogEntry({ domain: 'github.com', isAllowed: true }),
        createLogEntry({ domain: 'github.com', isAllowed: false }),
        createLogEntry({ domain: 'npmjs.org', isAllowed: true }),
      ];

      const stats = aggregateLogs(entries);

      expect(stats.uniqueDomains).toBe(2);
      expect(stats.byDomain.get('github.com')).toEqual({
        domain: 'github.com',
        allowed: 2,
        denied: 1,
        total: 3,
      });
      expect(stats.byDomain.get('npmjs.org')).toEqual({
        domain: 'npmjs.org',
        allowed: 1,
        denied: 0,
        total: 1,
      });
    });

    it('should calculate time range correctly', () => {
      const entries: ParsedLogEntry[] = [
        createLogEntry({ timestamp: 1000.5 }),
        createLogEntry({ timestamp: 2000.5 }),
        createLogEntry({ timestamp: 1500.5 }),
      ];

      const stats = aggregateLogs(entries);

      expect(stats.timeRange).toEqual({
        start: 1000.5,
        end: 2000.5,
      });
    });

    it('should handle entries with missing domain', () => {
      const entries: ParsedLogEntry[] = [
        createLogEntry({ domain: '-', isAllowed: true }),
        createLogEntry({ domain: 'github.com', isAllowed: true }),
      ];

      const stats = aggregateLogs(entries);

      expect(stats.uniqueDomains).toBe(2);
      expect(stats.byDomain.has('-')).toBe(true);
      expect(stats.byDomain.has('github.com')).toBe(true);
    });
  });

  describe('loadAllLogs', () => {
    it('should load logs from a running container', async () => {
      const mockLogContent = [
        '1761074374.646 172.30.0.20:39748 api.github.com:443 140.82.114.22:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "-"',
        '1761074375.123 172.30.0.20:39749 evil.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE evil.com:443 "curl/7.81.0"',
      ].join('\n');

      mockedExeca.mockResolvedValue({
        stdout: mockLogContent,
        stderr: '',
        exitCode: 0,
      } as never);

      const source: LogSource = {
        type: 'running',
        containerName: 'awf-squid',
      };

      const entries = await loadAllLogs(source);

      expect(entries).toHaveLength(2);
      expect(entries[0].domain).toBe('api.github.com');
      expect(entries[0].isAllowed).toBe(true);
      expect(entries[1].domain).toBe('evil.com');
      expect(entries[1].isAllowed).toBe(false);
    });

    it('should load logs from a file', async () => {
      const mockLogContent = [
        '1761074374.646 172.30.0.20:39748 api.github.com:443 140.82.114.22:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "-"',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockLogContent);

      const source: LogSource = {
        type: 'preserved',
        path: '/tmp/squid-logs-123',
      };

      const entries = await loadAllLogs(source);

      expect(entries).toHaveLength(1);
      expect(entries[0].domain).toBe('api.github.com');
      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        '/tmp/squid-logs-123/access.log',
        'utf-8'
      );
    });

    it('should return empty array if file does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const source: LogSource = {
        type: 'preserved',
        path: '/tmp/squid-logs-missing',
      };

      const entries = await loadAllLogs(source);

      expect(entries).toHaveLength(0);
    });

    it('should return empty array if container command fails', async () => {
      mockedExeca.mockRejectedValue(new Error('Container not found'));

      const source: LogSource = {
        type: 'running',
        containerName: 'awf-squid',
      };

      const entries = await loadAllLogs(source);

      expect(entries).toHaveLength(0);
    });

    it('should skip unparseable lines', async () => {
      const mockLogContent = [
        '1761074374.646 172.30.0.20:39748 api.github.com:443 140.82.114.22:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "-"',
        'invalid line that cannot be parsed',
        '',
        '1761074375.123 172.30.0.20:39749 npmjs.org:443 104.16.0.0:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT npmjs.org:443 "-"',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockLogContent);

      const source: LogSource = {
        type: 'preserved',
        path: '/tmp/squid-logs-123',
      };

      const entries = await loadAllLogs(source);

      expect(entries).toHaveLength(2);
      expect(entries[0].domain).toBe('api.github.com');
      expect(entries[1].domain).toBe('npmjs.org');
    });
  });

  describe('loadAndAggregate', () => {
    it('should load and aggregate logs in one call', async () => {
      const mockLogContent = [
        '1761074374.646 172.30.0.20:39748 api.github.com:443 140.82.114.22:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "-"',
        '1761074375.123 172.30.0.20:39749 api.github.com:443 140.82.114.22:443 1.1 CONNECT 200 TCP_TUNNEL:HIER_DIRECT api.github.com:443 "-"',
        '1761074376.456 172.30.0.20:39750 evil.com:443 -:- 1.1 CONNECT 403 TCP_DENIED:HIER_NONE evil.com:443 "curl/7.81.0"',
      ].join('\n');

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(mockLogContent);

      const source: LogSource = {
        type: 'preserved',
        path: '/tmp/squid-logs-123',
      };

      const stats = await loadAndAggregate(source);

      expect(stats.totalRequests).toBe(3);
      expect(stats.allowedRequests).toBe(2);
      expect(stats.deniedRequests).toBe(1);
      expect(stats.uniqueDomains).toBe(2);
    });
  });
});

/**
 * Helper function to create a mock ParsedLogEntry with default values
 */
function createLogEntry(overrides: Partial<ParsedLogEntry> = {}): ParsedLogEntry {
  return {
    timestamp: 1761074374.646,
    clientIp: '172.30.0.20',
    clientPort: '39748',
    host: 'api.github.com:443',
    destIp: '140.82.114.22',
    destPort: '443',
    protocol: '1.1',
    method: 'CONNECT',
    statusCode: 200,
    decision: 'TCP_TUNNEL:HIER_DIRECT',
    url: 'api.github.com:443',
    userAgent: '-',
    domain: 'api.github.com',
    isAllowed: true,
    isHttps: true,
    ...overrides,
  };
}
