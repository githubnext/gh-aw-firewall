import chalk from 'chalk';
import { LogLevel } from './types';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.error(chalk.gray(`[DEBUG] ${message}`), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.blue(`[INFO] ${message}`), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.error(chalk.yellow(`[WARN] ${message}`), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(chalk.red(`[ERROR] ${message}`), ...args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.error(chalk.green(`[SUCCESS] ${message}`), ...args);
    }
  }
}

export const logger = new Logger();
