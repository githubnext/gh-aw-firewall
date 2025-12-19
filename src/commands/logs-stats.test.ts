/**
 * Tests for logs-stats command
 */

import { statsCommand, StatsCommandOptions } from './logs-stats';
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

describe('logs-stats command', () => {
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
    mockedFormatter.formatStats.mockReturnValue('formatted output');

    const options: StatsCommandOptions = {
      format: 'pretty',
    };

    await statsCommand(options);

    expect(mockedDiscovery.discoverLogSources).toHaveBeenCalled();
    expect(mockedDiscovery.selectMostRecent).toHaveBeenCalled();
    expect(mockedAggregator.loadAndAggregate).toHaveBeenCalledWith(mockSource);
    expect(mockedFormatter.formatStats).toHaveBeenCalled();
    expect(mockConsoleLog).toHaveBeenCalledWith('formatted output');
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

    const options: StatsCommandOptions = {
      format: 'json',
      source: '/custom/path',
    };

    await statsCommand(options);

    expect(mockedDiscovery.validateSource).toHaveBeenCalledWith('/custom/path');
    expect(mockedAggregator.loadAndAggregate).toHaveBeenCalledWith(mockSource);
  });

  it('should exit with error if no sources found', async () => {
    mockedDiscovery.discoverLogSources.mockResolvedValue([]);

    const options: StatsCommandOptions = {
      format: 'pretty',
    };

    await expect(statsCommand(options)).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error if specified source is invalid', async () => {
    mockedDiscovery.discoverLogSources.mockResolvedValue([]);
    mockedDiscovery.validateSource.mockRejectedValue(new Error('Source not found'));

    const options: StatsCommandOptions = {
      format: 'pretty',
      source: '/invalid/path',
    };

    await expect(statsCommand(options)).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should pass correct format to formatter', async () => {
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
    mockedFormatter.formatStats.mockReturnValue('{}');

    await statsCommand({ format: 'json' });
    expect(mockedFormatter.formatStats).toHaveBeenCalledWith(
      expect.anything(),
      'json',
      expect.any(Boolean)
    );

    mockedFormatter.formatStats.mockClear();
    await statsCommand({ format: 'markdown' });
    expect(mockedFormatter.formatStats).toHaveBeenCalledWith(
      expect.anything(),
      'markdown',
      expect.any(Boolean)
    );

    mockedFormatter.formatStats.mockClear();
    await statsCommand({ format: 'pretty' });
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

    const options: StatsCommandOptions = {
      format: 'pretty',
    };

    await expect(statsCommand(options)).rejects.toThrow('process.exit called');
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
