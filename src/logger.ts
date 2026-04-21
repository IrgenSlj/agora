export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  
  setLevel(level: LogLevel) {
    this.level = level;
  }
  
  debug(...args: any[]) {
    if (this.level <= LogLevel.DEBUG) {
      console.debug('[Agora DEBUG]', ...args);
    }
  }
  
  info(...args: any[]) {
    if (this.level <= LogLevel.INFO) {
      console.log('[Agora INFO]', ...args);
    }
  }
  
  warn(...args: any[]) {
    if (this.level <= LogLevel.WARN) {
      console.warn('[Agora WARN]', ...args);
    }
  }
  
  error(...args: any[]) {
    if (this.level <= LogLevel.ERROR) {
      console.error('[Agora ERROR]', ...args);
    }
  }
}

export const logger = new Logger();

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

export function safeExecute<T>(fn: () => T, fallback: T, context = ''): T {
  try {
    return fn();
  } catch (error) {
    logger.error(`Error in ${context}:`, formatError(error));
    return fallback;
  }
}

export async function safeExecuteAsync<T>(
  fn: () => Promise<T>, 
  fallback: T, 
  context = ''
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error(`Async error in ${context}:`, formatError(error));
    return fallback;
  }
}