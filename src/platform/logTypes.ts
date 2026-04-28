export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'] as const;

export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface LogRecord {
  readonly ts: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
}

export interface LogSink {
  write(record: LogRecord): Promise<void>;
  flush(): Promise<void>;
}

export interface UserErrorChannel {
  notify(message: string): void;
  setStatus(message: string): void;
  clearStatus(): void;
}

export interface LogErrorOptions {
  readonly userFacing?: boolean;
  readonly userMessage?: string;
}

export type ConsoleLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export function formatLine(record: LogRecord): string {
  return JSON.stringify({
    ts: record.ts,
    level: record.level,
    event: record.event,
    ...record.fields,
  });
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVEL_ORDER;
}
