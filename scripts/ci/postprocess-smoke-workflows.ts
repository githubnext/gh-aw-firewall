#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const workflowPaths = [
  path.join(repoRoot, '.github/workflows/smoke-copilot.lock.yml'),
  path.join(repoRoot, '.github/workflows/smoke-claude.lock.yml'),
];

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
    `${scriptIndent}sudo tee /usr/local/bin/awf > /dev/null <<EOF`,
    `${scriptIndent}#!/bin/bash`,
    `${scriptIndent}exec "${'${NODE_BIN}'}" "${'${WORKSPACE_PATH}'}/dist/cli.js" "\\$@"`,
    `${scriptIndent}EOF`,
    `${scriptIndent}sudo chmod +x /usr/local/bin/awf`,
  ].join('\n') + '\n';
}

for (const workflowPath of workflowPaths) {
  const content = fs.readFileSync(workflowPath, 'utf-8');
  const matches = content.match(installStepRegexGlobal);

  if (!matches || matches.length === 0) {
    console.log(`Skipping ${workflowPath}: no awf install step found.`);
    continue;
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one awf install step in ${workflowPath}, found ${matches.length}. ` +
        'Ensure the workflow has a single "Install awf binary" step in the agent job.'
    );
  }

  const updated = content.replace(
    installStepRegexGlobal,
    (_match, indent: string) => buildLocalInstallSteps(indent)
  );

  fs.writeFileSync(workflowPath, updated);
  console.log(`Updated ${workflowPath}`);
}
