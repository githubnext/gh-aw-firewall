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

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface Args {
  runId?: string;
  workflow?: string;
  output?: string;
  repo?: string;
  help?: boolean;
}

function parseArgs(args: string[]): Args {
  const result: Args = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--run-id':
        result.runId = args[++i];
        break;
      case '--workflow':
        result.workflow = args[++i];
        break;
      case '--output':
        result.output = args[++i];
        break;
      case '--repo':
        result.repo = args[++i];
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
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkGhAuth(): boolean {
  try {
    execSync('gh auth status', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getLatestRunId(workflow?: string, repo?: string): string | null {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const workflowFlag = workflow ? `--workflow ${workflow}` : '';

  try {
    const cmd = `gh run list ${repoFlag} ${workflowFlag} --limit 1 --json databaseId --jq '.[0].databaseId'`;
    const result = execSync(cmd, { encoding: 'utf-8' }).trim();
    return result || null;
  } catch (error) {
    console.error('Failed to get latest run ID:', error);
    return null;
  }
}

function getRunInfo(
  runId: string,
  repo?: string
): { name: string; conclusion: string; status: string; createdAt: string } | null {
  const repoFlag = repo ? `--repo ${repo}` : '';

  try {
    const cmd = `gh run view ${runId} ${repoFlag} --json name,conclusion,status,createdAt`;
    const result = execSync(cmd, { encoding: 'utf-8' });
    return JSON.parse(result);
  } catch (error) {
    console.error('Failed to get run info:', error);
    return null;
  }
}

function downloadLogs(runId: string, outputDir: string, repo?: string): boolean {
  const repoFlag = repo ? `--repo ${repo}` : '';

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\nDownloading logs to: ${outputDir}`);

  try {
    // Download all artifacts
    const cmd = `gh run download ${runId} ${repoFlag} --dir "${outputDir}"`;
    const result = spawnSync('sh', ['-c', cmd], {
      stdio: 'inherit',
      encoding: 'utf-8',
    });

    if (result.status !== 0) {
      console.error('Warning: Some artifacts may not have been downloaded');
    }

    // Also try to download the job logs
    console.log('\nDownloading job logs...');
    const logsCmd = `gh run view ${runId} ${repoFlag} --log > "${path.join(outputDir, 'job-logs.txt')}" 2>&1`;
    try {
      execSync(logsCmd, { encoding: 'utf-8' });
    } catch {
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
    const repoPath = args.repo || execSync('gh repo view --json nameWithOwner --jq .nameWithOwner', { encoding: 'utf-8' }).trim();
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
