/**
 * Docker Container Egress Tests - Intermediate
 * Port of Docker-related tests from scripts/ci/test-firewall-robustness.sh
 *
 * Tests Docker container egress control:
 * - DNS controls from containers
 * - Proxy pivot attempts
 * - Container-to-container bounce
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { cleanup } from '../fixtures/cleanup';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';

describe('Docker Container Egress - Intermediate', () => {
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
    // Clean up test containers and networks
    await docker.rm('badproxy', true);
    await docker.rm('fwd', true);
    await cleanup(false);
  }, 30000);

  beforeEach(async () => {
    // Clean up between tests
    await docker.rm('badproxy', true);
    await docker.rm('fwd', true);
  }, 30000);

  describe('8C. DNS controls from container', () => {
    test('Container: Custom resolver with allowed domain', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm --dns 8.8.8.8 curlimages/curl:latest -fsS https://api.github.com/zen',
        {
          allowDomains: ['api.github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toSucceed();
    }, 120000);

    test("Container: /etc/hosts injection shouldn't bypass", async () => {
      const result = await runner.runWithSudo(
        `bash -c 'ip=$(getent hosts example.com | awk "{print \\$1}" | head -1); if [ -z "$ip" ]; then echo "Failed to resolve IP" && exit 1; fi; docker run --rm --add-host github.com:$ip curlimages/curl:latest -fk https://github.com --max-time 5'`,
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('8D. Proxy pivot attempts inside Docker', () => {
    test('Container: Block internal HTTP proxy pivot', async () => {
      // Start malicious internal proxy
      await docker.pullImage('dannydirect/tinyproxy:latest');
      await docker.run({
        image: 'dannydirect/tinyproxy:latest',
        name: 'badproxy',
        detach: true,
      });

      // Wait for proxy to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = await runner.runWithSudo(
        'docker run --rm --link badproxy curlimages/curl:latest -f -x http://badproxy:8888 https://example.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();

      // Cleanup
      await docker.rm('badproxy', true);
    }, 120000);

    test('Container: Block SOCKS proxy from container', async () => {
      const result = await runner.runWithSudo(
        'docker run --rm curlimages/curl:latest -f --socks5-hostname 127.0.0.1:1080 https://example.com --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();
    }, 120000);
  });

  describe('8E. Container-to-container bounce', () => {
    test('Container: Block TCP forwarder to disallowed host', async () => {
      // Start TCP forwarder to disallowed host
      await docker.run({
        image: 'alpine:latest',
        name: 'fwd',
        detach: true,
        command: ['sh', '-c', 'apk add --no-cache socat >/dev/null 2>&1 && socat TCP-LISTEN:8443,fork,reuseaddr TCP4:example.com:443'],
      });

      // Wait for forwarder to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      const result = await runner.runWithSudo(
        'docker run --rm --link fwd curlimages/curl:latest -fk https://fwd:8443 --max-time 5',
        {
          allowDomains: ['github.com'],
          logLevel: 'warn',
        timeout: 30000,
        }
      );

      expect(result).toFail();

      // Cleanup
      await docker.rm('fwd', true);
    }, 120000);
  });

  describe('8F. UDP, QUIC, multicast from container', () => {
    test('Container: Block mDNS (UDP/5353)', async () => {
      const result = await runner.runWithSudo(
        `docker run --rm alpine:latest sh -c 'apk add --no-cache netcat-openbsd >/dev/null 2>&1 && timeout 5 nc -u -w1 224.0.0.251 5353 </dev/null || exit 1'`,
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
