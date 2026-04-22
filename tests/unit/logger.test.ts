import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/platform/Logger';
import type { LogLevel, LogRecord, LogSink, UserErrorChannel } from '@/platform/logTypes';
import { formatLine } from '@/platform/logTypes';

function makeMemorySink(): LogSink & { records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    async write(record) {
      records.push(record);
    },
    async flush() {
      /* no-op */
    },
  };
}

function makeUserChannel(): UserErrorChannel & {
  notices: string[];
  statuses: string[];
} {
  const notices: string[] = [];
  const statuses: string[] = [];
  return {
    notices,
    statuses,
    notify(m) {
      notices.push(m);
    },
    setStatus(m) {
      statuses.push(m);
    },
    clearStatus() {
      statuses.push('');
    },
  };
}

function silentConsole(): {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const FIXED_TS = new Date('2026-04-21T10:00:00.000Z');

describe('Logger — level gating (NFR-LOG-01)', () => {
  const methods: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const expected: Record<LogLevel, LogLevel[]> = {
    debug: ['debug', 'info', 'warn', 'error'],
    info: ['info', 'warn', 'error'],
    warn: ['warn', 'error'],
    error: ['error'],
  };

  for (const configured of methods) {
    it(`level=${configured} emits only ${expected[configured].join(',')}`, async () => {
      const sink = makeMemorySink();
      const con = silentConsole();
      const logger = new Logger({
        level: configured,
        sink,
        clock: () => FIXED_TS,
        consoleImpl: con,
      });
      logger.debug('ev.debug');
      logger.info('ev.info');
      logger.warn('ev.warn');
      logger.error('ev.error');
      await logger.flush();

      expect(sink.records.map((r) => r.level)).toEqual(expected[configured]);
      expect(con.debug).toHaveBeenCalledTimes(expected[configured].includes('debug') ? 1 : 0);
      expect(con.info).toHaveBeenCalledTimes(expected[configured].includes('info') ? 1 : 0);
      expect(con.warn).toHaveBeenCalledTimes(expected[configured].includes('warn') ? 1 : 0);
      expect(con.error).toHaveBeenCalledTimes(expected[configured].includes('error') ? 1 : 0);
    });
  }

  it('default "info" suppresses debug and emits info|warn|error', async () => {
    const sink = makeMemorySink();
    const con = silentConsole();
    const logger = new Logger({ level: 'info', sink, clock: () => FIXED_TS, consoleImpl: con });
    logger.debug('nope');
    logger.info('yes');
    logger.warn('yes');
    logger.error('yes');
    await logger.flush();
    expect(sink.records.map((r) => r.event)).toEqual(['yes', 'yes', 'yes']);
  });
});

describe('Logger — console + file sink parity (NFR-LOG-01, NFR-LOG-02)', () => {
  it('emits identical payload shape to console and sink', async () => {
    const sink = makeMemorySink();
    const con = silentConsole();
    const logger = new Logger({ level: 'debug', sink, clock: () => FIXED_TS, consoleImpl: con });
    logger.info('rag.query', { k: 10, latencyMs: 42 });
    await logger.flush();

    expect(sink.records).toHaveLength(1);
    const record = sink.records[0]!;
    expect(record).toEqual({
      ts: FIXED_TS.toISOString(),
      level: 'info',
      event: 'rag.query',
      fields: { k: 10, latencyMs: 42 },
    });
    expect(con.info).toHaveBeenCalledTimes(1);
    expect(con.info).toHaveBeenCalledWith(formatLine(record));
  });

  it('routes each level to its matching console method', async () => {
    const sink = makeMemorySink();
    const con = silentConsole();
    const logger = new Logger({ level: 'debug', sink, clock: () => FIXED_TS, consoleImpl: con });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    await logger.flush();
    expect(con.debug).toHaveBeenCalledTimes(1);
    expect(con.info).toHaveBeenCalledTimes(1);
    expect(con.warn).toHaveBeenCalledTimes(1);
    expect(con.error).toHaveBeenCalledTimes(1);
  });
});

describe('Logger — user-facing errors (NFR-LOG-03)', () => {
  it('error with userFacing=true raises Notice and updates status bar', async () => {
    const sink = makeMemorySink();
    const user = makeUserChannel();
    const logger = new Logger({
      level: 'info',
      sink,
      userChannel: user,
      clock: () => FIXED_TS,
      consoleImpl: silentConsole(),
    });
    logger.error(
      'lm.disconnected',
      { host: 'localhost' },
      { userFacing: true, userMessage: 'LM Studio offline' },
    );
    await logger.flush();
    expect(user.notices).toEqual(['LM Studio offline']);
    expect(user.statuses).toEqual(['LM Studio offline']);
  });

  it('error without userFacing does not raise Notice', async () => {
    const sink = makeMemorySink();
    const user = makeUserChannel();
    const logger = new Logger({
      level: 'info',
      sink,
      userChannel: user,
      clock: () => FIXED_TS,
      consoleImpl: silentConsole(),
    });
    logger.error('internal.parse', { line: 3 });
    await logger.flush();
    expect(user.notices).toEqual([]);
    expect(user.statuses).toEqual([]);
  });

  it.each(['debug', 'info', 'warn'] as const)(
    '%s never raises Notice even with fields',
    async (level) => {
      const sink = makeMemorySink();
      const user = makeUserChannel();
      const logger = new Logger({
        level: 'debug',
        sink,
        userChannel: user,
        clock: () => FIXED_TS,
        consoleImpl: silentConsole(),
      });
      logger[level]('whatever', { foo: 'bar' });
      await logger.flush();
      expect(user.notices).toEqual([]);
      expect(user.statuses).toEqual([]);
    },
  );
});

describe('Logger — structured payload round-trip (NFR-LOG-04)', () => {
  it('round-trips arbitrary structured fields through file sink as JSON', async () => {
    const sink = makeMemorySink();
    const logger = new Logger({
      level: 'debug',
      sink,
      clock: () => FIXED_TS,
      consoleImpl: silentConsole(),
    });
    const fields = {
      k: 10,
      latencyMs: 42.5,
      nested: { a: 1, b: [true, false] },
      note: null,
    };
    logger.debug('rag.query', fields);
    await logger.flush();
    const line = formatLine(sink.records[0]!);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      ts: FIXED_TS.toISOString(),
      level: 'debug',
      event: 'rag.query',
      k: 10,
      latencyMs: 42.5,
      nested: { a: 1, b: [true, false] },
      note: null,
    });
  });
});

describe('Logger — flush awaits pending writes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush resolves after queued sink writes complete', async () => {
    let resolveWrite!: () => void;
    const pending = new Promise<void>((r) => {
      resolveWrite = r;
    });
    const sink: LogSink = {
      write: () => pending,
      flush: async () => undefined,
    };
    const logger = new Logger({
      level: 'info',
      sink,
      clock: () => FIXED_TS,
      consoleImpl: silentConsole(),
    });
    logger.info('x');
    let flushed = false;
    const flushPromise = logger.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    resolveWrite();
    await flushPromise;
    expect(flushed).toBe(true);
  });
});
