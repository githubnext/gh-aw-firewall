#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const workflowPaths = [
  // Existing smoke workflows
  path.join(repoRoot, '.github/workflows/smoke-copilot.lock.yml'),
  path.join(repoRoot, '.github/workflows/smoke-claude.lock.yml'),
  path.join(repoRoot, '.github/workflows/smoke-chroot.lock.yml'),
  // Build test workflows
  path.join(repoRoot, '.github/workflows/build-test-node.lock.yml'),
  path.join(repoRoot, '.github/workflows/build-test-go.lock.yml'),
  path.join(repoRoot, '.github/workflows/build-test-rust.lock.yml'),
  path.join(repoRoot, '.github/workflows/build-test-java.lock.yml'),
  path.join(repoRoot, '.github/workflows/build-test-cpp.lock.yml'),
  path.join(repoRoot, '.github/workflows/build-test-deno.lock.yml'),
  path.join(repoRoot, '.github/workflows/build-test-bun.lock.yml'),
];

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

// Matches the sparse checkout step so we can convert it to full checkout
// (needed for npm ci/npm run build which require the full repo)
const sparseCheckoutRegex =
  /^(\s*)- name: Checkout \.github and \.agents folders\n\1\s*uses: actions\/checkout@[^\n]+\n(?:\1\s*[^\n]*\n)*?\1\s*persist-credentials: false\n/m;

// Workflows where the workspace should be cleaned after build to reduce
// Copilot CLI context size (full repo = 1M tokens, sparse = 200k tokens)
const workflowsNeedingCleanup = new Set([
  path.join(repoRoot, '.github/workflows/smoke-copilot.lock.yml'),
]);

function buildCleanupStep(indent: string): string {
  const stepIndent = indent;
  const runIndent = `${indent}  `;
  const scriptIndent = `${runIndent}  `;

  return [
    `${stepIndent}- name: Clean workspace for agent`,
    `${runIndent}run: |`,
    `${scriptIndent}# Remove source code to reduce Copilot CLI context size`,
    `${scriptIndent}# Keep .github, .agents, dist, node_modules, package.json, containers (needed for awf)`,
    `${scriptIndent}cd "$GITHUB_WORKSPACE"`,
    `${scriptIndent}find . -maxdepth 1 -not -name '.' -not -name '.github' -not -name '.agents' -not -name 'dist' -not -name 'node_modules' -not -name 'package.json' -not -name 'containers' -not -name '.git' | xargs rm -rf`,
  ].join('\n') + '\n';
}

for (const workflowPath of workflowPaths) {
  let content = fs.readFileSync(workflowPath, 'utf-8');
  let modified = false;

  // Step 1: Convert sparse checkout to full checkout (needed for npm ci)
  if (sparseCheckoutRegex.test(content)) {
    content = content.replace(sparseCheckoutRegex, (match, indent: string) => {
      return [
        `${indent}- name: Checkout repository`,
        `${indent}  uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6`,
        `${indent}  with:`,
        `${indent}    persist-credentials: false`,
      ].join('\n') + '\n';
    });
    modified = true;
  }

  // Step 2: Replace "Install awf binary" with local build steps
  const matches = content.match(installStepRegexGlobal);

  if (!matches || matches.length === 0) {
    if (modified) {
      fs.writeFileSync(workflowPath, content);
      console.log(`Updated ${workflowPath} (checkout only)`);
    } else {
      console.log(`Skipping ${workflowPath}: no awf install step found.`);
    }
    continue;
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one awf install step in ${workflowPath}, found ${matches.length}. ` +
        'Ensure the workflow has a single "Install awf binary" step in the agent job.'
    );
  }

  content = content.replace(
    installStepRegexGlobal,
    (_match, indent: string) => {
      return buildLocalInstallSteps(indent);
    }
  );

  // Step 3: Replace --image-tag X.Y.Z with --build-local in awf commands
  // so smoke tests build containers from local source instead of using GHCR images
  content = content.replace(/--image-tag\s+\d+\.\d+\.\d+/g, '--build-local');

  // Step 3b: Remove --skip-pull since it's incompatible with --build-local
  // (building images requires pulling base images from the registry)
  content = content.replace(/\s*--skip-pull/g, '');

  // Step 4: Replace "Download pre-built images" step with local docker build
  // The download step pulls GHCR images; with --build-local, awf builds them itself
  // but we still need to pre-pull non-firewall images (MCP gateway, playwright, etc.)
  const downloadStepRegex =
    /^(\s*)- name: Download container images\n\1\s*run: bash \/opt\/gh-aw\/actions\/download_docker_images\.sh (.+)\n/m;
  if (downloadStepRegex.test(content)) {
    content = content.replace(downloadStepRegex, (_match, indent: string, images: string) => {
      // Filter out firewall images (agent/squid), keep external images (MCP, playwright, etc.)
      const externalImages = images.split(/\s+/).filter(
        (img: string) => !img.includes('gh-aw-firewall/agent') && !img.includes('gh-aw-firewall/squid')
      );
      const buildSteps = [
        `${indent}- name: Build local containers`,
        `${indent}  run: |`,
        `${indent}    docker build -t ghcr.io/github/gh-aw-firewall/squid:latest containers/squid/`,
        `${indent}    docker build -t ghcr.io/github/gh-aw-firewall/agent:latest containers/agent/`,
        `${indent}    docker build -t ghcr.io/github/gh-aw-firewall/agent-act:latest -f containers/agent/Dockerfile --build-arg BASE_IMAGE=ghcr.io/catthehacker/ubuntu:act-24.04 containers/agent/`,
      ];
      if (externalImages.length > 0) {
        buildSteps.push(
          `${indent}- name: Download external images`,
          `${indent}  run: bash /opt/gh-aw/actions/download_docker_images.sh ${externalImages.join(' ')}`,
        );
      }
      let result = buildSteps.join('\n') + '\n';
      // Add cleanup step after container builds for workflows that need reduced context
      if (workflowsNeedingCleanup.has(workflowPath)) {
        result += buildCleanupStep(indent);
      }
      return result;
    });
  }

  fs.writeFileSync(workflowPath, content);
  console.log(`Updated ${workflowPath}`);
}
