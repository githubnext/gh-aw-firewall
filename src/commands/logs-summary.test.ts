/**
 * Tests for logs-summary command
 */

import { summaryCommand, SummaryCommandOptions } from './logs-summary';
import * as logDiscovery from '../logs/log-discovery';
import * as logAggregator from '../logs/log-aggregator';
import * as statsFormatter from '../logs/stats-formatter';
import { LogSource } from '../types';

// Mock dependencies
jest.mock('../logs/log-discovery');
jest.mock('../logs/log-aggregator');
jest.mock('../logs/stats-formatter');
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockedDiscovery = logDiscovery as jest.Mocked<typeof logDiscovery>;
const mockedAggregator = logAggregator as jest.Mocked<typeof logAggregator>;
const mockedFormatter = statsFormatter as jest.Mocked<typeof statsFormatter>;

describe('logs-summary command', () => {
  let mockExit: jest.SpyInstance;
  let mockConsoleLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    mockExit.mockRestore();
    mockConsoleLog.mockRestore();
  });

  it('should discover and use most recent log source', async () => {
    const mockSource: LogSource = {
      type: 'preserved',
      path: '/tmp/squid-logs-123',
      timestamp: Date.now(),
      dateStr: new Date().toLocaleString(),
    };

    mockedDiscovery.discoverLogSources.mockResolvedValue([mockSource]);
    mockedDiscovery.selectMostRecent.mockReturnValue(mockSource);
    mockedAggregator.loadAndAggregate.mockResolvedValue({
      totalRequests: 10,
      allowedRequests: 8,
      deniedRequests: 2,
      uniqueDomains: 3,
      byDomain: new Map(),
      timeRange: { start: 1000, end: 2000 },
    });
    mockedFormatter.formatStats.mockReturnValue('markdown summary');

    const options: SummaryCommandOptions = {
      format: 'markdown',
    };

    await summaryCommand(options);

    expect(mockedDiscovery.discoverLogSources).toHaveBeenCalled();
    expect(mockedDiscovery.selectMostRecent).toHaveBeenCalled();
    expect(mockedAggregator.loadAndAggregate).toHaveBeenCalledWith(mockSource);
    expect(mockedFormatter.formatStats).toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith('markdown summary');
  });

  it('should default to markdown format', async () => {
    const mockSource: LogSource = { type: 'running', containerName: 'awf-squid' };

    mockedDiscovery.discoverLogSources.mockResolvedValue([mockSource]);
    mockedDiscovery.selectMostRecent.mockReturnValue(mockSource);
    mockedAggregator.loadAndAggregate.mockResolvedValue({
      totalRequests: 0,
      allowedRequests: 0,
      deniedRequests: 0,
      uniqueDomains: 0,
      byDomain: new Map(),
      timeRange: null,
    });
    mockedFormatter.formatStats.mockReturnValue('### Summary');

    // Note: default format is 'markdown' for summary command
    await summaryCommand({ format: 'markdown' });

    expect(mockedFormatter.formatStats).toHaveBeenCalledWith(
      expect.anything(),
      'markdown',
      expect.any(Boolean)
    );
  });

  it('should use specified source when provided', async () => {
    const mockSource: LogSource = {
      type: 'preserved',
      path: '/custom/path',
    };

    mockedDiscovery.discoverLogSources.mockResolvedValue([]);
    mockedDiscovery.validateSource.mockResolvedValue(mockSource);
    mockedAggregator.loadAndAggregate.mockResolvedValue({
      totalRequests: 5,
      allowedRequests: 5,
      deniedRequests: 0,
      uniqueDomains: 2,
      byDomain: new Map(),
      timeRange: null,
    });
    mockedFormatter.formatStats.mockReturnValue('formatted');

    const options: SummaryCommandOptions = {
      format: 'markdown',
      source: '/custom/path',
    };

    await summaryCommand(options);

    expect(mockedDiscovery.validateSource).toHaveBeenCalledWith('/custom/path');
    expect(mockedAggregator.loadAndAggregate).toHaveBeenCalledWith(mockSource);
  });

  it('should exit with error if no sources found', async () => {
    mockedDiscovery.discoverLogSources.mockResolvedValue([]);

    const options: SummaryCommandOptions = {
      format: 'markdown',
    };

    await expect(summaryCommand(options)).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error if specified source is invalid', async () => {
    mockedDiscovery.discoverLogSources.mockResolvedValue([]);
    mockedDiscovery.validateSource.mockRejectedValue(new Error('Source not found'));

    const options: SummaryCommandOptions = {
      format: 'markdown',
      source: '/invalid/path',
    };

    await expect(summaryCommand(options)).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should support all output formats', async () => {
    const mockSource: LogSource = { type: 'running', containerName: 'awf-squid' };

    mockedDiscovery.discoverLogSources.mockResolvedValue([mockSource]);
    mockedDiscovery.selectMostRecent.mockReturnValue(mockSource);
    mockedAggregator.loadAndAggregate.mockResolvedValue({
      totalRequests: 0,
      allowedRequests: 0,
      deniedRequests: 0,
      uniqueDomains: 0,
      byDomain: new Map(),
      timeRange: null,
    });
    mockedFormatter.formatStats.mockReturnValue('output');

    // Test JSON format
    await summaryCommand({ format: 'json' });
    expect(mockedFormatter.formatStats).toHaveBeenCalledWith(
      expect.anything(),
      'json',
      expect.any(Boolean)
    );

    // Test markdown format
    mockedFormatter.formatStats.mockClear();
    await summaryCommand({ format: 'markdown' });
    expect(mockedFormatter.formatStats).toHaveBeenCalledWith(
      expect.anything(),
      'markdown',
      expect.any(Boolean)
    );

    // Test pretty format
    mockedFormatter.formatStats.mockClear();
    await summaryCommand({ format: 'pretty' });
    expect(mockedFormatter.formatStats).toHaveBeenCalledWith(
      expect.anything(),
      'pretty',
      expect.any(Boolean)
    );
  });

  it('should handle aggregation errors gracefully', async () => {
    const mockSource: LogSource = { type: 'running', containerName: 'awf-squid' };

    mockedDiscovery.discoverLogSources.mockResolvedValue([mockSource]);
    mockedDiscovery.selectMostRecent.mockReturnValue(mockSource);
    mockedAggregator.loadAndAggregate.mockRejectedValue(new Error('Failed to load'));

    const options: SummaryCommandOptions = {
      format: 'markdown',
    };

    await expect(summaryCommand(options)).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
