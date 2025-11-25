#!/usr/bin/env node

/**
 * Generate release notes from template
 *
 * Usage: node scripts/generate-release-notes.js <changelog_file> <cli_help_file> <output_file>
 *
 * Environment variables:
 *   REPOSITORY - GitHub repository (e.g., githubnext/gh-aw-firewall)
 *   VERSION - Version tag (e.g., v0.3.0)
 *   VERSION_NUMBER - Version number without v prefix (e.g., 0.3.0)
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'docs', 'RELEASE_TEMPLATE.md');

function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: generate-release-notes.js <changelog_file> <cli_help_file> <output_file>');
    process.exit(1);
  }

  const [changelogFile, cliHelpFile, outputFile] = args;

  // Validate environment variables
  const repository = process.env.REPOSITORY;
  const version = process.env.VERSION;
  const versionNumber = process.env.VERSION_NUMBER;

  if (!repository || !version || !versionNumber) {
    console.error('Error: Missing required environment variables');
    console.error('Required: REPOSITORY, VERSION, VERSION_NUMBER');
    process.exit(1);
  }

  // Read template file
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`Error: Template file not found: ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  const templateContent = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  // Extract content after '---' separator
  const separatorIndex = templateContent.indexOf('\n---\n');
  if (separatorIndex === -1) {
    console.error('Error: Template file missing "---" separator');
    process.exit(1);
  }

  let template = templateContent.substring(separatorIndex + 5); // Skip '\n---\n'

  // Read changelog
  if (!fs.existsSync(changelogFile)) {
    console.error(`Error: Changelog file not found: ${changelogFile}`);
    process.exit(1);
  }
  const changelog = fs.readFileSync(changelogFile, 'utf8');

  if (!changelog.trim()) {
    console.error('Error: Changelog file is empty');
    process.exit(1);
  }

  // Read CLI help
  if (!fs.existsSync(cliHelpFile)) {
    console.error(`Error: CLI help file not found: ${cliHelpFile}`);
    process.exit(1);
  }
  const cliHelp = fs.readFileSync(cliHelpFile, 'utf8');

  if (!cliHelp.trim()) {
    console.error('Error: CLI help file is empty');
    process.exit(1);
  }

  // Perform substitutions (safe string replacement, no regex interpretation)
  let result = template;
  result = result.split('{{CHANGELOG}}').join(changelog.trim());
  result = result.split('{{CLI_HELP}}').join(cliHelp.trim());
  result = result.split('{{REPOSITORY}}').join(repository);
  result = result.split('{{VERSION}}').join(version);
  result = result.split('{{VERSION_NUMBER}}').join(versionNumber);

  // Ensure file ends with newline
  if (!result.endsWith('\n')) {
    result += '\n';
  }

  // Write output
  fs.writeFileSync(outputFile, result, 'utf8');

  console.log(`Release notes generated successfully: ${outputFile}`);
  console.log(`  - Template: ${TEMPLATE_PATH}`);
  console.log(`  - Changelog: ${changelog.split('\n').length} lines`);
  console.log(`  - CLI Help: ${cliHelp.split('\n').length} lines`);
  console.log(`  - Output: ${result.split('\n').length} lines`);
}

main();
