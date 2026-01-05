#!/usr/bin/env npx tsx
/**
 * Download workflow summary from GitHub Actions
 *
 * This script provides a summary of GitHub Actions workflow runs including
 * job status, timing, and failure information.
 *
 * Usage:
 *   npx tsx download-workflow-summary.ts [options]
 *
 * Options:
 *   --run-id <id>       Get summary for a specific workflow run ID
 *   --workflow <file>   Filter by workflow file (e.g., test-integration.yml)
 *   --limit <n>         Number of runs to summarize (default: 5)
 *   --format <type>     Output format: pretty (default), json, markdown
 *   --repo <owner/repo> Repository to query (default: current repo)
 *   --help              Show this help message
 */

import { execSync } from 'child_process';

interface Args {
  runId?: string;
  workflow?: string;
  limit?: number;
  format?: 'pretty' | 'json' | 'markdown';
  repo?: string;
  help?: boolean;
}

interface WorkflowRun {
  databaseId: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  headSha: string;
  url: string;
  event: string;
}

interface Job {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string;
  steps: Step[];
}

interface Step {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

interface RunDetails {
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  event: string;
  jobs: Job[];
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
      case '--limit':
        result.limit = parseInt(args[++i], 10);
        break;
      case '--format':
        result.format = args[++i] as 'pretty' | 'json' | 'markdown';
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
Download Workflow Summary

Get a summary of GitHub Actions workflow runs.

Usage:
  npx tsx download-workflow-summary.ts [options]

Options:
  --run-id <id>       Get summary for a specific workflow run ID
  --workflow <file>   Filter by workflow file (e.g., test-integration.yml)
  --limit <n>         Number of runs to summarize (default: 5)
  --format <type>     Output format: pretty (default), json, markdown
  --repo <owner/repo> Repository to query (default: current repo)
  --help, -h          Show this help message

Examples:
  # Get summary of latest runs
  npx tsx download-workflow-summary.ts

  # Get summary for a specific run
  npx tsx download-workflow-summary.ts --run-id 1234567890

  # Get summary for a specific workflow
  npx tsx download-workflow-summary.ts --workflow test-integration.yml

  # Output as JSON
  npx tsx download-workflow-summary.ts --format json

  # Output as Markdown
  npx tsx download-workflow-summary.ts --format markdown
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

function getWorkflowRuns(workflow: string | undefined, limit: number, repo?: string): WorkflowRun[] {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const workflowFlag = workflow ? `--workflow ${workflow}` : '';

  try {
    const cmd = `gh run list ${repoFlag} ${workflowFlag} --limit ${limit} --json databaseId,name,displayTitle,status,conclusion,createdAt,updatedAt,headBranch,headSha,url,event`;
    const result = execSync(cmd, { encoding: 'utf-8' });
    return JSON.parse(result);
  } catch (error) {
    console.error('Failed to get workflow runs:', error);
    return [];
  }
}

function getRunDetails(runId: string, repo?: string): RunDetails | null {
  const repoFlag = repo ? `--repo ${repo}` : '';

  try {
    const cmd = `gh run view ${runId} ${repoFlag} --json name,displayTitle,status,conclusion,createdAt,updatedAt,headBranch,event,jobs`;
    const result = execSync(cmd, { encoding: 'utf-8' });
    return JSON.parse(result);
  } catch (error) {
    console.error('Failed to get run details:', error);
    return null;
  }
}

function formatDuration(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationMs = endDate.getTime() - startDate.getTime();

  if (durationMs < 0) return 'in progress';

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function getStatusEmoji(status: string, conclusion: string | null): string {
  if (status === 'in_progress' || status === 'queued') {
    return '🔄';
  }
  switch (conclusion) {
    case 'success':
      return '✅';
    case 'failure':
      return '❌';
    case 'cancelled':
      return '⚠️';
    case 'skipped':
      return '⏭️';
    default:
      return '❓';
  }
}

function formatPretty(runs: WorkflowRun[], details: Map<number, RunDetails>): void {
  console.log('\n==========================================');
  console.log('Workflow Summary');
  console.log('==========================================\n');

  for (const run of runs) {
    const emoji = getStatusEmoji(run.status, run.conclusion);
    const detail = details.get(run.databaseId);

    console.log(`${emoji} Run #${run.databaseId}: ${run.displayTitle}`);
    console.log(`   Workflow: ${run.name}`);
    console.log(`   Branch: ${run.headBranch}`);
    console.log(`   Event: ${run.event}`);
    console.log(`   Status: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`);
    console.log(`   Created: ${new Date(run.createdAt).toLocaleString()}`);

    if (detail && detail.jobs.length > 0) {
      console.log('   Jobs:');
      for (const job of detail.jobs) {
        const jobEmoji = getStatusEmoji(job.status, job.conclusion);
        const duration =
          job.startedAt && job.completedAt ? formatDuration(job.startedAt, job.completedAt) : 'pending';
        console.log(`     ${jobEmoji} ${job.name} (${duration})`);

        // Show failed steps
        const failedSteps = job.steps?.filter((s) => s.conclusion === 'failure') || [];
        for (const step of failedSteps) {
          console.log(`        ❌ Step ${step.number}: ${step.name}`);
        }
      }
    }

    console.log(`   URL: ${run.url}`);
    console.log('');
  }
}

function formatJson(runs: WorkflowRun[], details: Map<number, RunDetails>): void {
  const output = runs.map((run) => ({
    ...run,
    jobs: details.get(run.databaseId)?.jobs || [],
  }));
  console.log(JSON.stringify(output, null, 2));
}

function formatMarkdown(runs: WorkflowRun[], details: Map<number, RunDetails>): void {
  console.log('# Workflow Summary\n');
  console.log(`Generated: ${new Date().toISOString()}\n`);

  console.log('| Run | Workflow | Status | Branch | Duration | Link |');
  console.log('|-----|----------|--------|--------|----------|------|');

  for (const run of runs) {
    const emoji = getStatusEmoji(run.status, run.conclusion);
    const duration = formatDuration(run.createdAt, run.updatedAt);
    const status = run.conclusion || run.status;
    console.log(
      `| ${emoji} #${run.databaseId} | ${run.name} | ${status} | ${run.headBranch} | ${duration} | [View](${run.url}) |`
    );
  }

  console.log('\n## Job Details\n');

  for (const run of runs) {
    const detail = details.get(run.databaseId);
    if (!detail || detail.jobs.length === 0) continue;

    const emoji = getStatusEmoji(run.status, run.conclusion);
    console.log(`### ${emoji} Run #${run.databaseId}: ${run.displayTitle}\n`);

    console.log('| Job | Status | Duration |');
    console.log('|-----|--------|----------|');

    for (const job of detail.jobs) {
      const jobEmoji = getStatusEmoji(job.status, job.conclusion);
      const duration =
        job.startedAt && job.completedAt ? formatDuration(job.startedAt, job.completedAt) : 'pending';
      const status = job.conclusion || job.status;
      console.log(`| ${jobEmoji} ${job.name} | ${status} | ${duration} |`);
    }

    // Show failed steps
    const failedJobs = detail.jobs.filter((j) => j.conclusion === 'failure');
    if (failedJobs.length > 0) {
      console.log('\n**Failed Steps:**\n');
      for (const job of failedJobs) {
        const failedSteps = job.steps?.filter((s) => s.conclusion === 'failure') || [];
        for (const step of failedSteps) {
          console.log(`- \`${job.name}\` > Step ${step.number}: ${step.name}`);
        }
      }
    }

    console.log('');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  const format = args.format || 'pretty';
  const limit = args.limit || 5;

  // Check prerequisites
  if (!checkGhCli()) {
    console.error('❌ Error: GitHub CLI (gh) is not installed.');
    console.error('Install it from: https://cli.github.com/');
    process.exit(1);
  }

  if (!checkGhAuth()) {
    console.error('❌ Error: Not authenticated with GitHub CLI.');
    console.error('Run: gh auth login');
    process.exit(1);
  }

  // Get workflow runs
  let runs: WorkflowRun[];

  if (args.runId) {
    // Get specific run
    const detail = getRunDetails(args.runId, args.repo);
    if (!detail) {
      console.error(`❌ Error: Could not find run ${args.runId}`);
      process.exit(1);
    }

    // Create a synthetic run object
    runs = [
      {
        databaseId: parseInt(args.runId, 10),
        name: detail.name,
        displayTitle: detail.displayTitle,
        status: detail.status,
        conclusion: detail.conclusion,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        headBranch: detail.headBranch,
        headSha: '',
        url: `https://github.com/${args.repo || 'unknown'}/actions/runs/${args.runId}`,
        event: detail.event,
      },
    ];
  } else {
    runs = getWorkflowRuns(args.workflow, limit, args.repo);
    if (runs.length === 0) {
      console.error('❌ Error: No workflow runs found');
      process.exit(1);
    }
  }

  // Get details for each run
  const details = new Map<number, RunDetails>();
  for (const run of runs) {
    const detail = getRunDetails(run.databaseId.toString(), args.repo);
    if (detail) {
      details.set(run.databaseId, detail);
    }
  }

  // Output in requested format
  switch (format) {
    case 'json':
      formatJson(runs, details);
      break;
    case 'markdown':
      formatMarkdown(runs, details);
      break;
    case 'pretty':
    default:
      formatPretty(runs, details);
      break;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
