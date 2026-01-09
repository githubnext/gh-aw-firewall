/**
 * Unit tests for preload command handler
 */

import execa from 'execa';
import { preloadCommand, getFirewallImages } from './preload';
import { logger } from '../logger';

// Mock execa
jest.mock('execa');
const mockedExeca = execa as jest.MockedFunction<typeof execa>;

// Mock the logger
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('getFirewallImages', () => {
  it('should return squid and agent images with default registry and tag', () => {
    const images = getFirewallImages('ghcr.io/githubnext/gh-aw-firewall', 'latest');

    expect(images).toEqual([
      'ghcr.io/githubnext/gh-aw-firewall/squid:latest',
      'ghcr.io/githubnext/gh-aw-firewall/agent:latest',
    ]);
  });

  it('should use custom registry and tag', () => {
    const images = getFirewallImages('my-registry.example.com/awf', 'v1.0.0');

    expect(images).toEqual([
      'my-registry.example.com/awf/squid:v1.0.0',
      'my-registry.example.com/awf/agent:v1.0.0',
    ]);
  });
});

describe('preloadCommand', () => {
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  it('should pull all firewall images successfully', async () => {
    // Mock successful docker pull (use 'as any' for mock return value)
    mockedExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    } as any);

    await preloadCommand({
      imageRegistry: 'ghcr.io/githubnext/gh-aw-firewall',
      imageTag: 'latest',
    });

    // Should call docker pull for each image
    expect(mockedExeca).toHaveBeenCalledTimes(2);
    expect(mockedExeca).toHaveBeenCalledWith(
      'docker',
      ['pull', 'ghcr.io/githubnext/gh-aw-firewall/squid:latest'],
      expect.objectContaining({ stdio: 'inherit' })
    );
    expect(mockedExeca).toHaveBeenCalledWith(
      'docker',
      ['pull', 'ghcr.io/githubnext/gh-aw-firewall/agent:latest'],
      expect.objectContaining({ stdio: 'inherit' })
    );

    // Should log success
    expect(mockedLogger.success).toHaveBeenCalledWith(
      'All container images pre-downloaded successfully'
    );
  });

  it('should throw error when an image fails to pull', async () => {
    // First image succeeds, second fails
    mockedExeca
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any)
      .mockRejectedValueOnce(new Error('Image not found'));

    await expect(
      preloadCommand({
        imageRegistry: 'ghcr.io/githubnext/gh-aw-firewall',
        imageTag: 'latest',
      })
    ).rejects.toThrow('Failed to download 1 image(s)');

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to pull image')
    );
  });

  it('should use custom registry and tag', async () => {
    mockedExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    } as any);

    await preloadCommand({
      imageRegistry: 'my-registry.example.com/awf',
      imageTag: 'v1.0.0',
    });

    expect(mockedExeca).toHaveBeenCalledWith(
      'docker',
      ['pull', 'my-registry.example.com/awf/squid:v1.0.0'],
      expect.objectContaining({ stdio: 'inherit' })
    );
    expect(mockedExeca).toHaveBeenCalledWith(
      'docker',
      ['pull', 'my-registry.example.com/awf/agent:v1.0.0'],
      expect.objectContaining({ stdio: 'inherit' })
    );
  });

  it('should log info about images being downloaded', async () => {
    mockedExeca.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
    } as any);

    await preloadCommand({
      imageRegistry: 'ghcr.io/githubnext/gh-aw-firewall',
      imageTag: 'latest',
    });

    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Pre-downloading 2 firewall container image(s)')
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Pulling image: ghcr.io/githubnext/gh-aw-firewall/squid:latest')
    );
  });
});
