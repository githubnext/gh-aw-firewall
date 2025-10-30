import debug from 'debug';
import chalk from 'chalk';
import { LogLevel } from './types';

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

// Create debug instances for different namespaces
const debugTrace = debug('awf:trace');
const debugDebug = debug('awf:debug');
const debugInfo = debug('awf:info');
const debugWarn = debug('awf:warn');
const debugError = debug('awf:error');
const debugSuccess = debug('awf:success');

// Configure debug to output to stderr
debug.log = (...args: unknown[]) => console.error(...args);

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
    this.updateDebugNamespaces();
  }

  setLevel(level: LogLevel): void {
    this.level = level;
    this.updateDebugNamespaces();
  }

  private updateDebugNamespaces(): void {
    // Enable debug namespaces based on log level
    const namespaces: string[] = [];
    
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.trace) {
      namespaces.push('awf:trace');
    }
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.debug) {
      namespaces.push('awf:debug');
    }
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.info) {
      namespaces.push('awf:info', 'awf:success');
    }
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.warn) {
      namespaces.push('awf:warn');
    }
    if (LOG_LEVELS[this.level] <= LOG_LEVELS.error) {
      namespaces.push('awf:error');
    }

    // Set DEBUG environment variable to enable the appropriate namespaces
    debug.enable(namespaces.join(','));
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  trace(message: string, ...args: unknown[]): void {
    if (this.shouldLog('trace')) {
      debugTrace(chalk.dim(`[TRACE] ${message}`), ...args);
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      debugDebug(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      debugInfo(chalk.blue(`[INFO] ${message}`), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      debugWarn(chalk.yellow(`[WARN] ${message}`), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      debugError(chalk.red(`[ERROR] ${message}`), ...args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      debugSuccess(chalk.green(`[SUCCESS] ${message}`), ...args);
    }
  }
}

export const logger = new Logger();
