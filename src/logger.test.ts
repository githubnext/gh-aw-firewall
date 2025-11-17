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
    });
  });
});
