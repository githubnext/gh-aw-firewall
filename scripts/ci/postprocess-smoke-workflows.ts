#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../..');
const workflowPaths = [
  path.join(repoRoot, '.github/workflows/smoke-copilot.lock.yml'),
  path.join(repoRoot, '.github/workflows/smoke-claude.lock.yml'),
];

const installStepRegex =
  /^ {6}- name: Install awf binary\n {8}run: bash \/opt\/gh-aw\/actions\/install_awf_binary\.sh v[0-9.]+\n/m;
const installStepRegexGlobal = new RegExp(installStepRegex.source, 'gm');

const localInstallSteps = [
  '      - name: Install awf dependencies',
  '        run: npm ci',
  '      - name: Build awf',
  '        run: npm run build',
  '      - name: Install awf binary (local)',
  '        run: |',
  '          WORKSPACE_PATH="${GITHUB_WORKSPACE:-$(pwd)}"',
  '          NODE_BIN="$(command -v node)"',
  '          sudo tee /usr/local/bin/awf > /dev/null <<EOF',
  '          #!/bin/bash',
  '          exec "${NODE_BIN}" "${WORKSPACE_PATH}/dist/cli.js" "\\$@"',
  '          EOF',
  '          sudo chmod +x /usr/local/bin/awf',
  '',
].join('\n');

for (const workflowPath of workflowPaths) {
  const content = fs.readFileSync(workflowPath, 'utf-8');
  const matches = content.match(installStepRegexGlobal);

  if (!matches || matches.length === 0) {
    console.log(`Skipping ${workflowPath}: no awf install step found.`);
    continue;
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one awf install step in ${workflowPath}, found ${matches.length}.`
    );
  }

  const updated = content.replace(installStepRegexGlobal, localInstallSteps);

  fs.writeFileSync(workflowPath, updated);
  console.log(`Updated ${workflowPath}`);
}
