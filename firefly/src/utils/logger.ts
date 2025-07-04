import { config } from '../config';
import { isFireflyError } from './errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  child(context: LogContext): Logger;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class ConsoleLogger implements Logger {
  private context: LogContext;
  private minLevel: number;

  constructor(context: LogContext = {}) {
    this.context = context;
    this.minLevel = LOG_LEVELS[config.logLevel];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.minLevel;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const mergedContext = { ...this.context, ...context };
    const contextStr = Object.keys(mergedContext).length > 0 
      ? ` ${JSON.stringify(mergedContext)}`
      : '';
    
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      let errorContext: LogContext = { ...context };
      
      if (error) {
        if (isFireflyError(error)) {
          errorContext = {
            ...errorContext,
            errorCode: error.code,
            errorContext: error.context,
            stack: error.stack
          };
        } else if (error instanceof Error) {
          errorContext = {
            ...errorContext,
            errorMessage: error.message,
            stack: error.stack
          };
        } else {
          errorContext = {
            ...errorContext,
            error: String(error)
          };
        }
      }
      
      console.error(this.formatMessage('error', message, errorContext));
    }
  }

  child(context: LogContext): Logger {
    return new ConsoleLogger({ ...this.context, ...context });
  }
}

// Export singleton logger instance
export const logger: Logger = new ConsoleLogger();

// Export function to create child loggers with specific context
export function createLogger(context: LogContext): Logger {
  return logger.child(context);
}