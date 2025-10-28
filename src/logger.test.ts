import { logger } from './logger';
import { LogLevel } from './types';

describe('Logger', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('log levels', () => {
    it('should log trace messages when level is trace', () => {
      logger.setLevel('trace');
      logger.trace('test trace message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[TRACE]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test trace message');
    });

    it('should log debug messages when level is trace', () => {
      logger.setLevel('trace');
      logger.debug('test debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test debug message');
    });

    it('should log info messages when level is trace', () => {
      logger.setLevel('trace');
      logger.info('test info message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test info message');
    });

    it('should not log trace messages when level is debug', () => {
      logger.setLevel('debug');
      logger.trace('test trace message');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log debug messages when level is debug', () => {
      logger.setLevel('debug');
      logger.debug('test debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test debug message');
    });

    it('should not log debug or trace messages when level is info', () => {
      logger.setLevel('info');
      logger.trace('test trace message');
      logger.debug('test debug message');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log info messages when level is info', () => {
      logger.setLevel('info');
      logger.info('test info message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[INFO]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test info message');
    });

    it('should only log warn and error messages when level is warn', () => {
      logger.setLevel('warn');
      logger.trace('test trace message');
      logger.debug('test debug message');
      logger.info('test info message');
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      logger.warn('test warn message');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[WARN]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test warn message');
    });

    it('should only log error messages when level is error', () => {
      logger.setLevel('error');
      logger.trace('test trace message');
      logger.debug('test debug message');
      logger.info('test info message');
      logger.warn('test warn message');
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      logger.error('test error message');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[ERROR]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test error message');
    });
  });

  describe('log level hierarchy', () => {
    it('should respect log level hierarchy', () => {
      // trace should log everything
      logger.setLevel('trace');
      consoleErrorSpy.mockClear();
      logger.trace('trace');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(5);

      // error should only log error
      logger.setLevel('error');
      consoleErrorSpy.mockClear();
      logger.trace('trace');
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should allow changing log level at runtime', () => {
      logger.setLevel('error');
      logger.debug('should not appear');
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      logger.setLevel('trace');
      logger.debug('should appear');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[DEBUG]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('should appear');
    });
  });

  describe('message formatting', () => {
    it('should include message text in trace output', () => {
      logger.setLevel('trace');
      logger.trace('my trace message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[TRACE]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('my trace message');
    });

    it('should support additional arguments in trace', () => {
      logger.setLevel('trace');
      const obj = { key: 'value' };
      const num = 123;
      logger.trace('message', obj, num);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[TRACE]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('message');
      expect(consoleErrorSpy.mock.calls[0][1]).toEqual(obj);
      expect(consoleErrorSpy.mock.calls[0][2]).toEqual(num);
    });
  });

  describe('success method', () => {
    it('should log success messages at info level', () => {
      logger.setLevel('info');
      logger.success('test success message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('[SUCCESS]');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('test success message');
    });

    it('should not log success messages when level is warn', () => {
      logger.setLevel('warn');
      logger.success('test success message');

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
