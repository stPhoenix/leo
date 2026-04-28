import type {
  ConsoleLike,
  LogErrorOptions,
  LogFields,
  LogLevel,
  LogRecord,
  LogSink,
  UserErrorChannel,
} from './logTypes';
import { LEVEL_ORDER, formatLine } from './logTypes';

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly sink: LogSink;
  readonly userChannel?: UserErrorChannel | null;
  readonly clock?: () => Date;
  readonly consoleImpl?: ConsoleLike;
}

export class Logger {
  private level: LogLevel;
  private readonly sink: LogSink;
  private readonly userChannel: UserErrorChannel | null;
  private readonly clock: () => Date;
  private readonly consoleImpl: ConsoleLike;
  private readonly pending = new Set<Promise<void>>();

  constructor(opts: LoggerOptions) {
    this.level = opts.level;
    this.sink = opts.sink;
    this.userChannel = opts.userChannel ?? null;
    this.clock = opts.clock ?? (() => new Date());
    this.consoleImpl = opts.consoleImpl ?? console;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(event: string, fields: LogFields = {}): void {
    this.emit('debug', event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.emit('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.emit('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}, opts: LogErrorOptions = {}): void {
    this.emit('error', event, fields);
    if (opts.userFacing && this.userChannel !== null) {
      const msg = opts.userMessage ?? event;
      this.userChannel.notify(msg);
      this.userChannel.setStatus(msg);
    }
  }

  async flush(): Promise<void> {
    if (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
    await this.sink.flush();
  }

  private emit(level: LogLevel, event: string, fields: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const record: LogRecord = {
      ts: this.clock().toISOString(),
      level,
      event,
      fields,
    };
    this.consoleImpl[level](formatLine(record));
    const p = this.sink.write(record).catch(() => {
      /* sink errors never bubble; the sink owns its own error path */
    });
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }
}
