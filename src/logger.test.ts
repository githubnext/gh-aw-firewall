import { logger } from './logger';
import { LogLevel } from './types';

describe('Logger', () => {
  // Store original console.error
  const originalConsoleError = console.error;
  let consoleOutput: string[] = [];

  beforeEach(() => {
    // Mock console.error to capture output
    consoleOutput = [];
    console.error = jest.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(arg => String(arg)).join(' '));
    });
  });

  afterEach(() => {
    // Restore original console.error
    console.error = originalConsoleError;
  });

  describe('log levels', () => {
    it('should log trace messages when level is trace', () => {
      logger.setLevel('trace');
      logger.trace('Test trace message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[TRACE]');
      expect(consoleOutput[0]).toContain('Test trace message');
    });

    it('should log debug messages when level is trace', () => {
      logger.setLevel('trace');
      logger.debug('Test debug message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[DEBUG]');
      expect(consoleOutput[0]).toContain('Test debug message');
    });

    it('should log debug messages when level is debug', () => {
      logger.setLevel('debug');
      logger.debug('Test debug message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[DEBUG]');
      expect(consoleOutput[0]).toContain('Test debug message');
    });

    it('should log info messages when level is info', () => {
      logger.setLevel('info');
      logger.info('Test info message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[INFO]');
      expect(consoleOutput[0]).toContain('Test info message');
    });

    it('should log warn messages when level is warn', () => {
      logger.setLevel('warn');
      logger.warn('Test warn message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[WARN]');
      expect(consoleOutput[0]).toContain('Test warn message');
    });

    it('should log error messages when level is error', () => {
      logger.setLevel('error');
      logger.error('Test error message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[ERROR]');
      expect(consoleOutput[0]).toContain('Test error message');
    });

    it('should log success messages when level is info', () => {
      logger.setLevel('info');
      logger.success('Test success message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[SUCCESS]');
      expect(consoleOutput[0]).toContain('Test success message');
    });
  });

  describe('log filtering', () => {
    it('should not log trace when level is debug', () => {
      logger.setLevel('debug');
      logger.trace('Should not appear');

      expect(consoleOutput.length).toBe(0);
    });

    it('should not log debug when level is info', () => {
      logger.setLevel('info');
      logger.debug('Should not appear');

      expect(consoleOutput.length).toBe(0);
    });

    it('should not log info when level is warn', () => {
      logger.setLevel('warn');
      logger.info('Should not appear');

      expect(consoleOutput.length).toBe(0);
    });

    it('should not log warn when level is error', () => {
      logger.setLevel('error');
      logger.warn('Should not appear');

      expect(consoleOutput.length).toBe(0);
    });

    it('should not log success when level is error', () => {
      logger.setLevel('error');
      logger.success('Should not appear');

      expect(consoleOutput.length).toBe(0);
    });
  });

  describe('log level hierarchy', () => {
    it('trace level should log all messages', () => {
      logger.setLevel('trace');
      
      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleOutput.length).toBe(5);
    });

    it('debug level should log debug and above', () => {
      logger.setLevel('debug');
      
      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleOutput.length).toBe(4);
      expect(consoleOutput.some(msg => msg.includes('[TRACE]'))).toBe(false);
    });

    it('info level should log info and above', () => {
      logger.setLevel('info');
      
      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleOutput.length).toBe(3);
      expect(consoleOutput.some(msg => msg.includes('[TRACE]'))).toBe(false);
      expect(consoleOutput.some(msg => msg.includes('[DEBUG]'))).toBe(false);
    });

    it('warn level should log warn and above', () => {
      logger.setLevel('warn');
      
      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleOutput.length).toBe(2);
      expect(consoleOutput.some(msg => msg.includes('[WARN]'))).toBe(true);
      expect(consoleOutput.some(msg => msg.includes('[ERROR]'))).toBe(true);
    });

    it('error level should only log errors', () => {
      logger.setLevel('error');
      
      logger.trace('Trace message');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[ERROR]');
    });
  });

  describe('setLevel', () => {
    it('should change log level dynamically', () => {
      logger.setLevel('error');
      logger.info('Should not appear');
      expect(consoleOutput.length).toBe(0);

      logger.setLevel('info');
      logger.info('Should appear');
      expect(consoleOutput.length).toBe(1);
    });

    it('should accept all valid log levels', () => {
      const validLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
      
      validLevels.forEach(level => {
        expect(() => logger.setLevel(level)).not.toThrow();
      });
    });
  });

  describe('message formatting', () => {
    it('should support additional arguments', () => {
      logger.setLevel('info');
      logger.info('Message with', 'multiple', 'arguments');

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('Message with');
      expect(consoleOutput[0]).toContain('multiple');
      expect(consoleOutput[0]).toContain('arguments');
    });

    it('should handle object arguments', () => {
      logger.setLevel('debug');
      const obj = { key: 'value' };
      logger.debug('Object:', obj);

      expect(consoleOutput.length).toBe(1);
      expect(consoleOutput[0]).toContain('[DEBUG] Object:');
import chalk from 'chalk';

// Mock chalk to avoid terminal output issues in tests
jest.mock('chalk', () => ({
  gray: jest.fn((text) => text),
  blue: jest.fn((text) => text),
  yellow: jest.fn((text) => text),
  red: jest.fn((text) => text),
  green: jest.fn((text) => text),
}));

describe('logger', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Mock console.error to capture output
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    // Reset logger to default level before each test
    logger.setLevel('info');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('setLevel', () => {
    it('should set log level to debug', () => {
      logger.setLevel('debug');
      logger.debug('test message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[DEBUG] test message');
    });

    it('should set log level to info', () => {
      logger.setLevel('info');
      logger.info('test message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO] test message');
    });

    it('should set log level to warn', () => {
      logger.setLevel('warn');
      logger.warn('test message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] test message');
    });

    it('should set log level to error', () => {
      logger.setLevel('error');
      logger.error('test message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] test message');
    });
  });

  describe('debug', () => {
    it('should log debug messages when level is debug', () => {
      logger.setLevel('debug');
      logger.debug('debug message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[DEBUG] debug message');
    });

    it('should not log debug messages when level is info', () => {
      logger.setLevel('info');
      logger.debug('debug message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should not log debug messages when level is warn', () => {
      logger.setLevel('warn');
      logger.debug('debug message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should not log debug messages when level is error', () => {
      logger.setLevel('error');
      logger.debug('debug message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages with additional arguments', () => {
      logger.setLevel('debug');
      logger.debug('debug message', { key: 'value' }, 42);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[DEBUG] debug message', { key: 'value' }, 42);
    });
  });

  describe('info', () => {
    it('should log info messages when level is debug', () => {
      logger.setLevel('debug');
      logger.info('info message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO] info message');
    });

    it('should log info messages when level is info', () => {
      logger.setLevel('info');
      logger.info('info message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO] info message');
    });

    it('should not log info messages when level is warn', () => {
      logger.setLevel('warn');
      logger.info('info message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should not log info messages when level is error', () => {
      logger.setLevel('error');
      logger.info('info message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log info messages with additional arguments', () => {
      logger.setLevel('info');
      logger.info('info message', 'arg1', 'arg2');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO] info message', 'arg1', 'arg2');
    });
  });

  describe('warn', () => {
    it('should log warn messages when level is debug', () => {
      logger.setLevel('debug');
      logger.warn('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] warn message');
    });

    it('should log warn messages when level is info', () => {
      logger.setLevel('info');
      logger.warn('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] warn message');
    });

    it('should log warn messages when level is warn', () => {
      logger.setLevel('warn');
      logger.warn('warn message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] warn message');
    });

    it('should not log warn messages when level is error', () => {
      logger.setLevel('error');
      logger.warn('warn message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log warn messages with additional arguments', () => {
      logger.setLevel('warn');
      logger.warn('warn message', [1, 2, 3]);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] warn message', [1, 2, 3]);
    });
  });

  describe('error', () => {
    it('should log error messages when level is debug', () => {
      logger.setLevel('debug');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message');
    });

    it('should log error messages when level is info', () => {
      logger.setLevel('info');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message');
    });

    it('should log error messages when level is warn', () => {
      logger.setLevel('warn');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message');
    });

    it('should log error messages when level is error', () => {
      logger.setLevel('error');
      logger.error('error message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message');
    });

    it('should log error messages with additional arguments', () => {
      logger.setLevel('error');
      const err = new Error('test error');
      logger.error('error message', err);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error message', err);
    });
  });

  describe('success', () => {
    it('should log success messages when level is debug', () => {
      logger.setLevel('debug');
      logger.success('success message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[SUCCESS] success message');
    });

    it('should log success messages when level is info', () => {
      logger.setLevel('info');
      logger.success('success message');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[SUCCESS] success message');
    });

    it('should not log success messages when level is warn', () => {
      logger.setLevel('warn');
      logger.success('success message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should not log success messages when level is error', () => {
      logger.setLevel('error');
      logger.success('success message');
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log success messages with additional arguments', () => {
      logger.setLevel('info');
      logger.success('success message', 'extra', 'args');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[SUCCESS] success message', 'extra', 'args');
    });
  });

  describe('log level hierarchy', () => {
    it('should respect log level hierarchy - debug shows all', () => {
      logger.setLevel('debug');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.success('success');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(5);
    });

    it('should respect log level hierarchy - info shows info, warn, error, success', () => {
      logger.setLevel('info');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.success('success');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[INFO] info');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] warn');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[SUCCESS] success');
    });

    it('should respect log level hierarchy - warn shows warn and error only', () => {
      logger.setLevel('warn');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.success('success');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[WARN] warn');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error');
    });

    it('should respect log level hierarchy - error shows error only', () => {
      logger.setLevel('error');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      logger.success('success');
      
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] error');
    });
  });
});
