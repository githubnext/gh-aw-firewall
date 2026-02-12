#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');

// Find all .lock.yml files that contain "Ingest agent output" step
// This ensures we cover all agentic workflows, not just a hardcoded subset
const workflowsDir = path.join(repoRoot, '.github/workflows');
const allLockFiles = fs
  .readdirSync(workflowsDir)
  .filter((file) => file.endsWith('.lock.yml'))
  .map((file) => path.join(workflowsDir, file));

// Filter to only workflows that have the "Ingest agent output" step
const workflowPaths = allLockFiles.filter((filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.includes('- name: Ingest agent output');
});

// Matches the install step with captured indentation:
// - "Install awf binary" step at any indent level
// - run command invoking install_awf_binary.sh with a version
const installStepRegex =
  /^(\s*)- name: Install awf binary\n\1\s*run: bash \/opt\/gh-aw\/actions\/install_awf_binary\.sh v[0-9.]+\n/m;
const installStepRegexGlobal = new RegExp(installStepRegex.source, 'gm');

function buildLocalInstallSteps(indent: string): string {
  const stepIndent = indent;
  const runIndent = `${indent}  `;
  const scriptIndent = `${runIndent}  `;

  return [
    `${stepIndent}- name: Install awf dependencies`,
    `${runIndent}run: npm ci`,
    `${stepIndent}- name: Build awf`,
    `${runIndent}run: npm run build`,
    `${stepIndent}- name: Install awf binary (local)`,
    `${runIndent}run: |`,
    `${scriptIndent}WORKSPACE_PATH="${'${GITHUB_WORKSPACE:-$(pwd)}'}"`,
    `${scriptIndent}NODE_BIN="$(command -v node)"`,
    `${scriptIndent}if [ ! -d "$WORKSPACE_PATH" ]; then`,
    `${scriptIndent}  echo "Workspace path not found: $WORKSPACE_PATH"`,
    `${scriptIndent}  exit 1`,
    `${scriptIndent}fi`,
    `${scriptIndent}if [ ! -x "$NODE_BIN" ]; then`,
    `${scriptIndent}  echo "Node binary not found: $NODE_BIN"`,
    `${scriptIndent}  exit 1`,
    `${scriptIndent}fi`,
    `${scriptIndent}if [ ! -d "/usr/local/bin" ]; then`,
    `${scriptIndent}  echo "/usr/local/bin is missing"`,
    `${scriptIndent}  exit 1`,
    `${scriptIndent}fi`,
    `${scriptIndent}sudo tee /usr/local/bin/awf > /dev/null <<EOF`,
    `${scriptIndent}#!/bin/bash`,
    `${scriptIndent}exec "${'${NODE_BIN}'}" "${'${WORKSPACE_PATH}'}/dist/cli.js" "\\$@"`,
    `${scriptIndent}EOF`,
    `${scriptIndent}sudo chmod +x /usr/local/bin/awf`,
  ].join('\n') + '\n';
}

// Remove sparse-checkout from the agent job's checkout step so the full repo
// is available for npm ci / npm run build. The compiler generates sparse-checkout
// for .github and .agents only, but we need src/, package.json, tsconfig.json etc.
// Match the sparse-checkout block (key + indented content lines) and the depth line.
const sparseCheckoutRegex = /^(\s+)sparse-checkout: \|\n(?:\1  .+\n)+/gm;
const shallowDepthRegex = /^(\s+)depth: 1\n/gm;

// Replace --image-tag <version> --skip-pull with --build-local so smoke tests
// use locally-built container images (with the latest entrypoint.sh, setup-iptables.sh, etc.)
// instead of pre-built GHCR images that may be stale.
const imageTagRegex = /--image-tag\s+[0-9.]+\s+--skip-pull/g;

// Add if: always() to "Ingest agent output" step so it runs even if the agent execution fails.
// This ensures agent output is collected and uploaded as an artifact, allowing the conclusion
// job to download it for failure analysis.
// Pattern: match "- name: Ingest agent output" followed by "id: collect_output" on the next line
const ingestOutputRegex = /^(\s*)- name: Ingest agent output\n(\1\s+)id: collect_output\n/gm;

for (const workflowPath of workflowPaths) {
  let content = fs.readFileSync(workflowPath, 'utf-8');
  let modified = false;

  // Replace "Install awf binary" step with local build steps
  const matches = content.match(installStepRegexGlobal);
  if (matches) {
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one awf install step in ${workflowPath}, found ${matches.length}. ` +
          'Ensure the workflow has a single "Install awf binary" step in the agent job.'
      );
    }
    content = content.replace(
      installStepRegexGlobal,
      (_match, indent: string) => buildLocalInstallSteps(indent)
    );
    modified = true;
    console.log(`  Replaced awf install step with local build`);
  }

  // Remove sparse-checkout from agent job checkout (need full repo for npm build)
  const sparseMatches = content.match(sparseCheckoutRegex);
  if (sparseMatches) {
    content = content.replace(sparseCheckoutRegex, '');
    modified = true;
    console.log(`  Removed ${sparseMatches.length} sparse-checkout block(s)`);
  }

  // Remove shallow depth (depth: 1) since full checkout is needed
  const depthMatches = content.match(shallowDepthRegex);
  if (depthMatches) {
    content = content.replace(shallowDepthRegex, '');
    modified = true;
    console.log(`  Removed ${depthMatches.length} shallow depth setting(s)`);
  }

  // Replace GHCR image tags with local builds
  const imageTagMatches = content.match(imageTagRegex);
  if (imageTagMatches) {
    content = content.replace(imageTagRegex, '--build-local');
    modified = true;
    console.log(`  Replaced ${imageTagMatches.length} --image-tag/--skip-pull with --build-local`);
  }

  // Add if: always() to "Ingest agent output" step
  const ingestMatches = content.match(ingestOutputRegex);
  if (ingestMatches) {
    content = content.replace(ingestOutputRegex, (_match, indent: string, idIndent: string) => {
      return `${indent}- name: Ingest agent output\n${idIndent}if: always()\n${idIndent}id: collect_output\n`;
    });
    modified = true;
    console.log(`  Added if: always() to ${ingestMatches.length} "Ingest agent output" step(s)`);
  }

  if (modified) {
    fs.writeFileSync(workflowPath, content);
    console.log(`Updated ${path.basename(workflowPath)}`);
  } else {
    console.log(`Skipping ${path.basename(workflowPath)}: no changes needed.`);
  }
}

console.log(`\nProcessed ${workflowPaths.length} workflow(s) with "Ingest agent output" step`);
