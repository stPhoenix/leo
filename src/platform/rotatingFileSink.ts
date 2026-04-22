import type { LogRecord, LogSink } from './logTypes';
import { formatLine } from './logTypes';

export interface SinkFs {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
  append(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface RotatingFileSinkOptions {
  readonly path: string;
  readonly maxBytes?: number;
  readonly maxRotations?: number;
  readonly flushTimeoutMs?: number;
}

interface ResolvedOptions {
  readonly path: string;
  readonly maxBytes: number;
  readonly maxRotations: number;
  readonly flushTimeoutMs: number;
}

const DEFAULTS = {
  maxBytes: 1_000_000,
  maxRotations: 5,
  flushTimeoutMs: 250,
};

export class RotatingFileSink implements LogSink {
  private queue: Promise<void> = Promise.resolve();
  private currentSize = 0;
  private initialized = false;
  private readonly opts: ResolvedOptions;

  constructor(
    private readonly fs: SinkFs,
    opts: RotatingFileSinkOptions,
  ) {
    this.opts = {
      path: opts.path,
      maxBytes: opts.maxBytes ?? DEFAULTS.maxBytes,
      maxRotations: opts.maxRotations ?? DEFAULTS.maxRotations,
      flushTimeoutMs: opts.flushTimeoutMs ?? DEFAULTS.flushTimeoutMs,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    const stat = await this.fs.stat(this.opts.path);
    this.currentSize = stat?.size ?? 0;
    this.initialized = true;
  }

  write(record: LogRecord): Promise<void> {
    const line = formatLine(record) + '\n';
    const next = this.queue.then(() => this.writeLocked(line));
    this.queue = next.catch(() => undefined);
    return next;
  }

  async flush(): Promise<void> {
    const deadline = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('log-flush-timeout')), this.opts.flushTimeoutMs),
    );
    try {
      await Promise.race([this.queue, deadline]);
    } catch {
      /* bounded flush — drop tail on timeout */
    }
  }

  private async writeLocked(line: string): Promise<void> {
    if (!this.initialized) await this.init();
    const bytes = Buffer.byteLength(line, 'utf8');
    if (this.currentSize > 0 && this.currentSize + bytes > this.opts.maxBytes) {
      await this.rotate();
      this.currentSize = 0;
    }
    await this.fs.append(this.opts.path, line);
    this.currentSize += bytes;
  }

  private async rotate(): Promise<void> {
    const max = this.opts.maxRotations;
    const last = `${this.opts.path}.${max}`;
    if (await this.fs.exists(last)) {
      await this.fs.remove(last);
    }
    for (let i = max - 1; i >= 1; i--) {
      const from = `${this.opts.path}.${i}`;
      const to = `${this.opts.path}.${i + 1}`;
      if (await this.fs.exists(from)) {
        await this.fs.rename(from, to);
      }
    }
    if (await this.fs.exists(this.opts.path)) {
      await this.fs.rename(this.opts.path, `${this.opts.path}.1`);
    }
  }
}
