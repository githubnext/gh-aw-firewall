import os from 'os';
import path from 'path';

class ExitError extends Error {
  code: number;

  constructor(code: number) {
    super(`process.exit: ${code}`);
    this.code = code;
  }
}

type ActionHandler = (copilotCommand: string, options: Record<string, unknown>) => Promise<void>;

let capturedAction: ActionHandler | undefined;

const dockerManagerMock = {
  writeConfigs: jest.fn(),
  startContainers: jest.fn(),
  runCopilotCommand: jest.fn(),
  stopContainers: jest.fn(),
  cleanup: jest.fn(),
};

const loggerMock = {
  setLevel: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
};

jest.mock('commander', () => {
  return {
    Command: jest.fn().mockImplementation(() => {
      return {
        name: jest.fn().mockReturnThis(),
        description: jest.fn().mockReturnThis(),
        version: jest.fn().mockReturnThis(),
        requiredOption: jest.fn().mockReturnThis(),
        option: jest.fn().mockReturnThis(),
        argument: jest.fn().mockReturnThis(),
        action: jest.fn().mockImplementation(function (this: unknown, handler: ActionHandler) {
          capturedAction = handler;
          return this;
        }),
        parse: jest.fn().mockReturnThis(),
        parseAsync: jest.fn().mockReturnThis(),
      };
    }),
  };
});

jest.mock('../../dist/docker-manager', () => ({
  __esModule: true,
  ...dockerManagerMock,
}));

jest.mock('../../dist/logger', () => ({
  __esModule: true,
  logger: loggerMock,
}));

const CLI_PATH = path.join(__dirname, '../../dist/cli.js');
const testWorkDir = path.join(os.tmpdir(), 'awf-test');

describe('awf CLI allow-domains handling', () => {
  beforeEach(() => {
    capturedAction = undefined;
    jest.clearAllMocks();

    dockerManagerMock.writeConfigs.mockResolvedValue(undefined);
    dockerManagerMock.startContainers.mockResolvedValue(undefined);
    dockerManagerMock.runCopilotCommand.mockResolvedValue(0);
    dockerManagerMock.stopContainers.mockResolvedValue(undefined);
    dockerManagerMock.cleanup.mockResolvedValue(undefined);
  });

  const loadCli = () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require(CLI_PATH);
    });
  };

  it('passes allowed domains to the Docker workflow when running copilot', async () => {
    const exitMock = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined): never => {
        const normalized =
          typeof code === 'number'
            ? code
            : code == null
            ? 0
            : Number(code);
        if (normalized !== 0) {
          throw new ExitError(normalized);
        }
        return undefined as never;
      });

    try {
      loadCli();
      expect(typeof capturedAction).toBe('function');

      const options = {
        logLevel: 'info',
        allowDomains: 'github.com, api.github.com',
        keepContainers: false,
        workDir: testWorkDir,
      };

      await (capturedAction as ActionHandler)('copilot', options);

      expect(loggerMock.setLevel).toHaveBeenCalledWith('info');

      const configArg = dockerManagerMock.writeConfigs.mock.calls[0][0];
      expect(configArg.allowedDomains).toEqual(['github.com', 'api.github.com']);
      expect(configArg.copilotCommand).toBe('copilot');
      expect(configArg.workDir).toBe(testWorkDir);
      expect(configArg.keepContainers).toBe(false);
      expect(configArg.logLevel).toBe('info');

      expect(dockerManagerMock.startContainers).toHaveBeenCalledWith(testWorkDir);
      expect(dockerManagerMock.runCopilotCommand).toHaveBeenCalledWith(testWorkDir);
      expect(dockerManagerMock.stopContainers).toHaveBeenCalledWith(testWorkDir, false);
      expect(dockerManagerMock.cleanup).toHaveBeenCalledWith(testWorkDir, false);

      expect(loggerMock.info).toHaveBeenCalledWith('Allowed domains: github.com, api.github.com');
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      exitMock.mockRestore();
    }
  });

  it('exits with an error when allow-domains does not include a domain', async () => {
    const exitMock = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined): never => {
        const normalized =
          typeof code === 'number'
            ? code
            : code == null
            ? 0
            : Number(code);
        throw new ExitError(normalized);
      });

    try {
      loadCli();
      expect(typeof capturedAction).toBe('function');

      const options = {
        logLevel: 'info',
        allowDomains: '  ,  ',
        keepContainers: false,
        workDir: testWorkDir,
      };

      await expect((capturedAction as ActionHandler)('copilot', options)).rejects.toMatchObject({
        code: 1,
      });

      expect(loggerMock.error).toHaveBeenCalledWith(
        'At least one domain must be specified with --allow-domains'
      );
      expect(dockerManagerMock.writeConfigs).not.toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(1);
    } finally {
      exitMock.mockRestore();
    }
  });
});
