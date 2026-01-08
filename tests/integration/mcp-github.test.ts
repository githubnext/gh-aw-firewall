/**
 * GitHub MCP-style egress tests
 *
 * Verifies that AWF preserves GitHub tokens and enforces domain allowlists
 * for workloads that mimic the GitHub MCP server (Docker-based, GitHub API).
 */

/// <reference path="../jest-custom-matchers.d.ts" />

import { afterAll, beforeAll, describe, test, expect } from '@jest/globals';
import { createRunner, AwfRunner } from '../fixtures/awf-runner';
import { createDockerHelper, DockerHelper } from '../fixtures/docker-helper';
import { createLogParser } from '../fixtures/log-parser';
import { cleanup } from '../fixtures/cleanup';

const requiredDomains = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'ghcr.io'];
const githubAuthToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

const maybeDescribe = githubAuthToken ? describe : describe.skip;

maybeDescribe('GitHub MCP server egress control', () => {
  let runner: AwfRunner;
  let docker: DockerHelper;

  beforeAll(async () => {
    await cleanup(false);
    runner = createRunner();
    docker = createDockerHelper();

    // Pre-pull image so the test does not need Docker Hub/ghcr during filtered run
    await docker.pullImage('curlimages/curl:latest');
  }, 300000);

  afterAll(async () => {
    await cleanup(false);
  }, 30000);

  test(
    'allows GitHub API access for MCP workload with GitHub token',
    async () => {
      const result = await runner.runWithSudo(
        'docker run --rm -e GITHUB_TOKEN curlimages/curl:latest sh -c \'curl -fsS -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/rate_limit\'',
        {
          allowDomains: requiredDomains,
          logLevel: 'warn',
          timeout: 60000,
          env: {
            ...process.env,
            GITHUB_TOKEN: githubAuthToken as string,
          },
        }
      );

      expect(result).toSucceed();
      expect(result.stdout).toContain('"resources"');

      if (result.workDir) {
        const parser = createLogParser();
        const entries = await parser.readSquidLog(result.workDir);
        expect(parser.wasAllowed(entries, 'api.github.com')).toBe(true);
      }
    },
    120000
  );

  test(
    'starts GitHub MCP server container inside firewall',
    async () => {
      const result = await runner.runWithSudo(
        'timeout 12s docker run --rm -e GITHUB_TOKEN ghcr.io/github/github-mcp-server:v0.19.0 --version',
        {
          allowDomains: requiredDomains,
          logLevel: 'warn',
          timeout: 60000,
          env: {
            ...process.env,
            GITHUB_TOKEN: githubAuthToken as string,
          },
        }
      );

      expect(result).toSucceed();
    },
    120000
  );

  test(
    'blocks non-GitHub domains for MCP workload',
    async () => {
      const result = await runner.runWithSudo(
        'docker run --rm curlimages/curl:latest -fsS https://example.com --max-time 8',
        {
          allowDomains: requiredDomains,
          logLevel: 'warn',
          timeout: 60000,
        }
      );

      expect(result).toFail();

      if (result.workDir) {
        const parser = createLogParser();
        const entries = await parser.readSquidLog(result.workDir);
        expect(parser.wasBlocked(entries, 'example.com')).toBe(true);
      }
    },
    120000
  );
});
