import fs from 'fs';
import os from 'os';
import path from 'path';
import execa from 'execa';
import yaml from 'js-yaml';

const CLI_PATH = path.join(__dirname, '../../dist/cli.js');

const createTempDirs = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awf-int-'));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const workDir = path.join(root, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const logFile = path.join(root, 'docker-commands.log');
  fs.writeFileSync(logFile, '');

  return { root, binDir, workDir, logFile };
};

const createDockerStub = (binDir: string) => {
  const dockerPath = path.join(binDir, 'docker');
  const stubSource = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const logPath = process.env.MOCK_DOCKER_LOG;
if (logPath) {
  fs.appendFileSync(logPath, args.join(' ') + '\\n');
}

if (args[0] === 'compose') {
  const subCommand = args[1];
  if (subCommand === 'logs') {
    process.exit(0);
  }
  if (subCommand === 'up') {
    process.exit(0);
  }
  if (subCommand === 'down') {
    process.exit(0);
  }
}

if (args[0] === 'inspect') {
  process.stdout.write('0\\n');
  process.exit(0);
}

process.exit(0);
`;

  fs.writeFileSync(dockerPath, stubSource, { mode: 0o755 });
  return dockerPath;
};

const readLoggedCommands = (logFile: string): string[] => {
  if (!fs.existsSync(logFile)) {
    return [];
  }
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

describe('awf CLI integration', () => {
  let rootDir: string;
  let binDir: string;
  let workDir: string;
  let logFile: string;

  beforeEach(() => {
    const dirs = createTempDirs();
    rootDir = dirs.root;
    binDir = dirs.binDir;
    workDir = dirs.workDir;
    logFile = dirs.logFile;
    createDockerStub(binDir);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  const runCli = async (extraArgs: string[] = [], extraEnv: NodeJS.ProcessEnv = {}) => {
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      MOCK_DOCKER_LOG: logFile,
      ...extraEnv,
    };

    return execa(process.execPath, [
      CLI_PATH,
      '--allow-domains',
      'github.com,api.github.com',
      '--work-dir',
      workDir,
      ...extraArgs,
      'copilot',
    ], {
      env,
    });
  };

  it('runs the CLI end-to-end and cleans up work directory when containers are not kept', async () => {
    await runCli();

    const commands = readLoggedCommands(logFile);
    expect(commands).toEqual([
      'compose up -d',
      'compose logs -f copilot',
      'inspect awf-copilot --format={{.State.ExitCode}}',
      'compose down -v',
    ]);

    expect(fs.existsSync(workDir)).toBe(false);
  });

  it('preserves generated configs when --keep-containers is used', async () => {
    await runCli(['--keep-containers']);

    const commands = readLoggedCommands(logFile);
    expect(commands).toEqual([
      'compose up -d',
      'compose logs -f copilot',
      'inspect awf-copilot --format={{.State.ExitCode}}',
    ]);

    expect(fs.existsSync(workDir)).toBe(true);

    const squidConfigPath = path.join(workDir, 'squid.conf');
    const dockerComposePath = path.join(workDir, 'docker-compose.yml');

    expect(fs.existsSync(squidConfigPath)).toBe(true);
    expect(fs.existsSync(dockerComposePath)).toBe(true);

    const squidConfig = fs.readFileSync(squidConfigPath, 'utf8');
    expect(squidConfig).toContain('.github.com');
    expect(squidConfig).not.toContain('.api.github.com');

    const dockerComposeContent = fs.readFileSync(dockerComposePath, 'utf8');
    const dockerCompose = yaml.load(dockerComposeContent) as Record<string, unknown>;
    const services = (dockerCompose.services ?? {}) as Record<string, any>;
    const copilotService = services.copilot;

    expect(Array.isArray(copilotService.command)).toBe(true);
    expect(copilotService.command).toEqual(['/bin/bash', '-c', 'copilot']);
  });
});
