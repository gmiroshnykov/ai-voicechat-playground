export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  child(context: LogContext): Logger;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4
};

class ConsoleLogger implements Logger {
  private context: LogContext;
  private minLevel: number;

  constructor(logLevel: LogLevel = 'info', context: LogContext = {}) {
    this.context = context;
    this.minLevel = LOG_LEVELS[logLevel];
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

  trace(message: string, context?: LogContext): void {
    if (this.shouldLog('trace')) {
      console.log(this.formatMessage('trace', message, context));
    }
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
      const errorContext: LogContext = { 
        ...context
      };
      
      if (error !== undefined) {
        errorContext.error = error;  // Just pass it through - JSON.stringify in formatMessage handles it perfectly
      }
      
      console.error(this.formatMessage('error', message, errorContext));
    }
  }

  child(context: LogContext): Logger {
    // Need to pass the same log level to child logger
    // We'll store it as a property
    return new ConsoleLogger(this.logLevel, { ...this.context, ...context });
  }
  
  private get logLevel(): LogLevel {
    // Reverse lookup the log level from minLevel
    for (const [level, value] of Object.entries(LOG_LEVELS)) {
      if (value === this.minLevel) {
        return level as LogLevel;
      }
    }
    return 'info'; // fallback
  }
}

// Export mutable logger instance that will be initialized later
export let logger: Logger;

// Export function to initialize the logger
export function initializeLogger(logLevel: LogLevel): Logger {
  logger = new ConsoleLogger(logLevel);
  return logger;
}

// Export function to create child loggers with specific context
export function createLogger(context: LogContext): Logger {
  return logger.child(context);
}