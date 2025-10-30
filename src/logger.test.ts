import { logger } from './logger';
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
