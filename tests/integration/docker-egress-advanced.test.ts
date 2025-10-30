/**
 * Docker Container Egress Tests - Advanced
 * Port of Docker-related tests from scripts/ci/test-firewall-robustness.sh
 *
 * Tests Docker container egress control:
 * - Metadata & link-local protection
 * - Privilege & capability abuse
 * - Direct IP and SNI/Host mismatch
 * - IPv6 from containers
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';

describe('Docker Container Egress - Advanced', () => {
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

  describe('8G. Metadata & link-local protection', () => {
    test('Container: Block AWS/GCP metadata IPs (v4)', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm curlimages/curl:latest -f http://169.254.169.254 --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Container: Block IPv6 link-local multicast', async () => {
      const result = await runner.runWithSudo(
        `docker run --rm alpine:latest sh -c 'apk add --no-cache netcat-openbsd >/dev/null 2>&1 && timeout 5 nc -6 -u -w1 ff02::fb 5353 </dev/null || exit 1'`,
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('8H. Privilege & capability abuse', () => {
    test("Container: NET_ADMIN shouldn't defeat host egress", async () => {
      const result = await runner.runWithSudo(
        `docker run --rm --cap-add NET_ADMIN alpine:latest sh -c 'apk add --no-cache curl >/dev/null 2>&1 && curl -f https://example.com --max-time 5'`,
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Container: Privileged container still blocked', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm --privileged curlimages/curl:latest -f https://example.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('8I. Direct IP and SNI/Host mismatch from container', () => {
    test('Container: Block IP literal access', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm curlimages/curl:latest -f https://93.184.216.34 --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);

    test('Container: Block SNI/Host mismatch via --resolve', async () => {
      const result = await runner.runWithSudo(
        `bash -c 'ip=$(getent hosts example.com | awk "{print \\$1}" | head -1); if [ -z "$ip" ]; then echo "Failed to resolve IP" && exit 1; fi; docker run --rm curlimages/curl:latest --noproxy "*" -fk --resolve github.com:443:$ip https://github.com --max-time 5'`,
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('8L. IPv6 from containers', () => {
    test('Container: Block IPv6 literal (Cloudflare DNS)', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm curlimages/curl:latest -f https://[2606:4700:4700::1111] --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });
});
