/**
 * Docker Container Egress Tests - Basic
 * Port of Docker-related tests from scripts/ci/test-firewall-robustness.sh
 *
 * Tests Docker container egress control:
 * - Basic container egress (allow/block)
 * - Network modes (bridge, host, none, custom)
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';

describe('Docker Container Egress - Basic', () => {
  let runner: AwfRunner;
  let docker: DockerHelper;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
    docker = createDockerHelper();

    // Pre-pull images to avoid timeouts
    console.log('Pulling required Docker images...');
    await docker.pullImage('curlimages/curl:latest');
    await docker.pullImage('alpine:latest');
  }, 300000); // 5 minutes for image pulls

  afterAll(async () => {
    await cleanup(false);
  }, 30000);

  describe('8A. Basic container egress', () => {
    test('Container: Allow whitelisted domain (HTTPS)', async () => {
      const result = await runner.runWithSudo('docker run --rm curlimages/curl:latest -fsS https://api.github.com/zen', {
        allowDomains: ['api.github.com'],
        logLevel: 'warn',
        timeout: 30000,
      });

      expect(result).toSucceed();
    }, 120000);

    test('Container: Block non-whitelisted domain', async () => {
      const result = await runner.runWithSudo('docker run --rm curlimages/curl:latest -f https://example.com', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
        timeout: 30000,
      });

      expect(result).toFail();
    }, 120000);
  });

  describe('8B. Network modes', () => {
    test('Container: Bridge mode (default) honored', async () => {
      const result = await runner.runWithSudo('docker run --rm curlimages/curl:latest -fsS https://github.com/robots.txt', {
        allowDomains: ['github.com'],
        logLevel: 'warn',
        timeout: 30000,
      });

      expect(result).toSucceed();
    }, 120000);

    test('Container: Host mode must NOT bypass firewall', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm --network host curlimages/curl:latest -f https://example.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Container: None mode has no egress', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm --network none curlimages/curl:latest -f https://github.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('8J. Custom networks', () => {
    test('Container: User-defined bridge still enforced', async () => {
      // Create custom network
      await docker.createNetwork('tnet');

      const result = await runner.runWithSudo(
        'docker run --rm --network tnet curlimages/curl:latest -fsS https://api.github.com/zen',
        {
          allowDomains: ['api.github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toSucceed();

      // Cleanup
      await docker.removeNetwork('tnet');
    }, 120000);
  });
});
