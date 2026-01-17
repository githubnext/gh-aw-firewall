#!/usr/bin/env npx tsx
/**
 * Download workflow logs from GitHub Actions
 *
 * This script downloads logs from GitHub Actions workflow runs using the GitHub CLI.
 * It can download logs from a specific run or the latest run of a workflow.
 *
 * Usage:
 *   npx tsx download-workflow-logs.ts [options]
 *
 * Options:
 *   --run-id <id>       Download logs from a specific workflow run ID
 *   --workflow <file>   Filter by workflow file (e.g., test-integration.yml)
 *   --output <dir>      Output directory for logs (default: ./workflow-logs-<run-id>)
 *   --repo <owner/repo> Repository to download from (default: current repo)
 *   --help              Show this help message
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Args {
  runId?: string;
  workflow?: string;
  output?: string;
  repo?: string;
  help?: boolean;
}

/**
 * Validate that a run ID contains only numeric characters.
 */
function isValidRunId(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Validate that a workflow name contains only safe characters.
 * Allows alphanumeric characters, dashes, underscores, and dots.
 */
function isValidWorkflow(value: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(value);
}

/**
 * Validate that an output path contains only safe characters.
 * Allows alphanumeric characters, dashes, underscores, dots, and path separators.
 * Prevents path traversal by disallowing '..' sequences.
 */
function isValidOutputPath(value: string): boolean {
  if (value.includes('..')) {
    return false;
  }
  return /^[a-zA-Z0-9._\-/]+$/.test(value);
}

/**
 * Validate that a repo name is in owner/repo format.
 * Allows alphanumeric characters, dashes, underscores, and dots.
 */
function isValidRepo(value: string): boolean {
  return /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(value);
}

function parseArgs(args: string[]): Args {
  const result: Args = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--run-id':
        if (i + 1 >= args.length) {
          console.error('Error: --run-id requires a value');
          process.exit(1);
        }
        result.runId = args[++i];
        if (!isValidRunId(result.runId)) {
          console.error('Error: Invalid run-id format (must be numeric)');
          process.exit(1);
        }
        break;
      case '--workflow':
        if (i + 1 >= args.length) {
          console.error('Error: --workflow requires a value');
          process.exit(1);
        }
        result.workflow = args[++i];
        if (!isValidWorkflow(result.workflow)) {
          console.error('Error: Invalid workflow format');
          process.exit(1);
        }
        break;
      case '--output':
        if (i + 1 >= args.length) {
          console.error('Error: --output requires a value');
          process.exit(1);
        }
        result.output = args[++i];
        if (!isValidOutputPath(result.output)) {
          console.error('Error: Invalid output path format');
          process.exit(1);
        }
        break;
      case '--repo':
        if (i + 1 >= args.length) {
          console.error('Error: --repo requires a value');
          process.exit(1);
        }
        result.repo = args[++i];
        if (!isValidRepo(result.repo)) {
          console.error('Error: Invalid repo format (use owner/repo)');
          process.exit(1);
        }
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Download Workflow Logs

Download logs from GitHub Actions workflow runs.

Usage:
  npx tsx download-workflow-logs.ts [options]

Options:
  --run-id <id>       Download logs from a specific workflow run ID
  --workflow <file>   Filter by workflow file (e.g., test-integration.yml)
  --output <dir>      Output directory for logs (default: ./workflow-logs-<run-id>)
  --repo <owner/repo> Repository to download from (default: current repo)
  --help, -h          Show this help message

Examples:
  # Download logs from the latest run
  npx tsx download-workflow-logs.ts

  # Download logs from a specific run
  npx tsx download-workflow-logs.ts --run-id 1234567890

  # Download logs from a specific workflow
  npx tsx download-workflow-logs.ts --workflow test-integration.yml

  # Save to custom directory
  npx tsx download-workflow-logs.ts --output ./my-logs
`);
}

function checkGhCli(): boolean {
  const result = spawnSync('gh', ['--version'], { stdio: 'pipe' });
  return result.status === 0;
}

function checkGhAuth(): boolean {
  const result = spawnSync('gh', ['auth', 'status'], { stdio: 'pipe' });
  return result.status === 0;
}

function getLatestRunId(workflow?: string, repo?: string): string | null {
  try {
    const args = ['run', 'list', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId'];
    if (repo) {
      args.push('--repo', repo);
    }
    if (workflow) {
      args.push('--workflow', workflow);
    }
    const result = spawnSync('gh', args, { encoding: 'utf-8' });
    if (result.status !== 0) {
      return null;
    }
    return result.stdout?.trim() || null;
  } catch (error) {
    console.error('Failed to get latest run ID:', error);
    return null;
  }
}

function getRunInfo(
  runId: string,
  repo?: string
): { name: string; conclusion: string; status: string; createdAt: string } | null {
  try {
    const args = ['run', 'view', runId, '--json', 'name,conclusion,status,createdAt'];
    if (repo) {
      args.push('--repo', repo);
    }
    const result = spawnSync('gh', args, { encoding: 'utf-8' });
    if (result.status !== 0) {
      return null;
    }
    return JSON.parse(result.stdout);
  } catch (error) {
    console.error('Failed to get run info:', error);
    return null;
  }
}

function downloadLogs(runId: string, outputDir: string, repo?: string): boolean {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\nDownloading logs to: ${outputDir}`);

  try {
    // Download all artifacts using array arguments (prevents shell injection)
    const downloadArgs = ['run', 'download', runId, '--dir', outputDir];
    if (repo) {
      downloadArgs.push('--repo', repo);
    }
    const result = spawnSync('gh', downloadArgs, {
      stdio: 'inherit',
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      console.error('Warning: Some artifacts may not have been downloaded');
    }

    // Also try to download the job logs using array arguments
    console.log('\nDownloading job logs...');
    const viewArgs = ['run', 'view', runId, '--log'];
    if (repo) {
      viewArgs.push('--repo', repo);
    }
    const logsResult = spawnSync('gh', viewArgs, { encoding: 'utf-8' });
    if (logsResult.status === 0 && logsResult.stdout) {
      fs.writeFileSync(path.join(outputDir, 'job-logs.txt'), logsResult.stdout);
    } else {
      console.log('Note: Job logs may not be available or already included in artifacts');
    }

    return true;
  } catch (error) {
    console.error('Failed to download logs:', error);
    return false;
  }
}

function listDownloadedFiles(outputDir: string): void {
  console.log('\nDownloaded files:');
  try {
    const files = fs.readdirSync(outputDir, { withFileTypes: true });
    for (const file of files) {
      if (file.isDirectory()) {
        console.log(`  📁 ${file.name}/`);
        const subfiles = fs.readdirSync(path.join(outputDir, file.name));
        for (const subfile of subfiles) {
          const stats = fs.statSync(path.join(outputDir, file.name, subfile));
          const size = (stats.size / 1024).toFixed(1);
          console.log(`     - ${subfile} (${size} KB)`);
        }
      } else {
        const stats = fs.statSync(path.join(outputDir, file.name));
        const size = (stats.size / 1024).toFixed(1);
        console.log(`  📄 ${file.name} (${size} KB)`);
      }
    }
  } catch (error) {
    console.log('  Unable to list files');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  console.log('==========================================');
  console.log('Download Workflow Logs');
  console.log('==========================================');

  // Check prerequisites
  if (!checkGhCli()) {
    console.error('\n❌ Error: GitHub CLI (gh) is not installed.');
    console.error('Install it from: https://cli.github.com/');
    process.exit(1);
  }

  if (!checkGhAuth()) {
    console.error('\n❌ Error: Not authenticated with GitHub CLI.');
    console.error('Run: gh auth login');
    process.exit(1);
  }

  // Determine run ID
  let runId = args.runId;
  if (!runId) {
    console.log('\nFinding latest workflow run...');
    runId = getLatestRunId(args.workflow, args.repo);
    if (!runId) {
      console.error('\n❌ Error: No workflow runs found');
      if (args.workflow) {
        console.error(`  Workflow: ${args.workflow}`);
      }
      process.exit(1);
    }
    console.log(`Found latest run: ${runId}`);
  }

  // Get run info
  const runInfo = getRunInfo(runId, args.repo);
  if (runInfo) {
    console.log(`\nWorkflow Run: ${runInfo.name}`);
    console.log(`Status: ${runInfo.status}`);
    console.log(`Conclusion: ${runInfo.conclusion || 'in progress'}`);
    console.log(`Created: ${runInfo.createdAt}`);
  }

  // Determine output directory
  const outputDir = args.output || `./workflow-logs-${runId}`;

  // Download logs
  const success = downloadLogs(runId, outputDir, args.repo);

  if (success) {
    console.log('\n==========================================');
    console.log('✅ Download complete!');
    console.log('==========================================');
    listDownloadedFiles(outputDir);
    console.log(`\nLogs saved to: ${path.resolve(outputDir)}`);
    console.log(`\nView run on GitHub:`);
    let repoPath = args.repo;
    if (!repoPath) {
      const repoResult = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf-8' });
      repoPath = repoResult.stdout?.trim() || 'unknown';
    }
    console.log(`  https://github.com/${repoPath}/actions/runs/${runId}`);
  } else {
    console.error('\n❌ Download failed');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
