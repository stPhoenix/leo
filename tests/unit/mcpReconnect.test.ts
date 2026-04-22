import { describe, expect, it, vi } from 'vitest';
import {
  computeBackoffDelay,
  crashedToolCallError,
  MAX_RECONNECT_ATTEMPTS,
  runReconnectLoop,
  SHUTDOWN_SIGTERM_TIMEOUT_MS,
  shutdownStdioChild,
  type ChildProcessLike,
} from '@/mcp/reconnect';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {},
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

describe('computeBackoffDelay', () => {
  it('respects base + cap + jitter bounds', () => {
    const d0 = computeBackoffDelay(0, { baseMs: 500, capMs: 16_000, jitter: 0 });
    expect(d0).toBe(500);
    const d4 = computeBackoffDelay(4, { baseMs: 500, capMs: 16_000, jitter: 0 });
    expect(d4).toBe(8_000);
    const dCap = computeBackoffDelay(10, { baseMs: 500, capMs: 16_000, jitter: 0 });
    expect(dCap).toBe(16_000);
  });

  it('applies ±20% jitter deterministically with injected random', () => {
    const d = computeBackoffDelay(3, {
      baseMs: 500,
      capMs: 16_000,
      jitter: 0.2,
      random: () => 1.0,
    });
    expect(d).toBeGreaterThan(0);
    const dLow = computeBackoffDelay(3, {
      baseMs: 500,
      capMs: 16_000,
      jitter: 0.2,
      random: () => 0,
    });
    expect(dLow).toBeLessThan(d);
  });
});

describe('runReconnectLoop — AC1/AC2/AC3', () => {
  it('retries up to MAX_RECONNECT_ATTEMPTS and gives up — emits mcp.reconnect.gaveUp', async () => {
    vi.useFakeTimers();
    const { logger, records } = makeLogger();
    const handle = runReconnectLoop({
      serverId: 's1',
      transport: 'stdio',
      logger,
      attempt: async () => false,
      baseMs: 100,
      capMs: 100,
      jitter: 0,
      random: () => 0.5,
    });
    for (let i = 0; i < MAX_RECONNECT_ATTEMPTS + 1; i += 1) {
      await vi.advanceTimersByTimeAsync(200);
    }
    const res = await handle.promise;
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(MAX_RECONNECT_ATTEMPTS);
    expect(records.find((r) => r.event === 'mcp.reconnect.gaveUp')).toBeDefined();
    vi.useRealTimers();
  });

  it('resolves ok on attempt 3 and emits mcp.reconnect.ok', async () => {
    vi.useFakeTimers();
    const { logger, records } = makeLogger();
    let attempts = 0;
    const handle = runReconnectLoop({
      serverId: 's1',
      transport: 'stdio',
      logger,
      attempt: async () => {
        attempts += 1;
        return attempts >= 3;
      },
      baseMs: 50,
      capMs: 200,
      jitter: 0,
      random: () => 0.5,
    });
    for (let i = 0; i < 4; i += 1) await vi.advanceTimersByTimeAsync(250);
    const res = await handle.promise;
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(3);
    expect(records.find((r) => r.event === 'mcp.reconnect.ok')).toBeDefined();
    vi.useRealTimers();
  });

  it('cancel stops scheduling further attempts', async () => {
    vi.useFakeTimers();
    const { logger, records } = makeLogger();
    let attempts = 0;
    const handle = runReconnectLoop({
      serverId: 's1',
      transport: 'stdio',
      logger,
      attempt: async () => {
        attempts += 1;
        return false;
      },
      baseMs: 100,
      capMs: 100,
      jitter: 0,
    });
    await vi.advanceTimersByTimeAsync(150);
    handle.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    const res = await handle.promise;
    expect(res.ok).toBe(false);
    expect(attempts).toBeLessThanOrEqual(1);
    expect(records.find((r) => r.event === 'mcp.reconnect.gaveUp')).toBeUndefined();
    vi.useRealTimers();
  });
});

describe('shutdownStdioChild — AC6', () => {
  it('SIGTERM → clean exit resolves without SIGKILL', async () => {
    vi.useFakeTimers();
    const killSpy = vi.fn().mockReturnValue(true);
    let exitCb: ((code: number | null, signal: string | null) => void) | null = null;
    const proc: ChildProcessLike = {
      kill: killSpy,
      once: (ev, cb): void => {
        if (ev === 'exit') exitCb = cb;
      },
    };
    const { logger, records } = makeLogger();
    const done = shutdownStdioChild({ serverId: 's1', proc, logger });
    (exitCb as unknown as ((code: number | null, signal: string | null) => void) | null)?.(0, null);
    await done;
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(records.find((r) => r.event === 'mcp.shutdown.clean')).toBeDefined();
    vi.useRealTimers();
  });

  it('SIGTERM → 2 s timeout → SIGKILL escalation', async () => {
    vi.useFakeTimers();
    const killSpy = vi.fn().mockReturnValue(true);
    const proc: ChildProcessLike = {
      kill: killSpy,
      once: (): void => undefined,
    };
    const { logger, records } = makeLogger();
    const done = shutdownStdioChild({ serverId: 's1', proc, logger });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_SIGTERM_TIMEOUT_MS + 10);
    await done;
    expect(killSpy).toHaveBeenCalledTimes(2);
    expect(killSpy.mock.calls[0]).toEqual(['SIGTERM']);
    expect(killSpy.mock.calls[1]).toEqual(['SIGKILL']);
    expect(records.find((r) => r.event === 'mcp.shutdown.sigkill')).toBeDefined();
    vi.useRealTimers();
  });
});

describe('crashedToolCallError — AC4', () => {
  it('formats server id into canonical message', () => {
    expect(crashedToolCallError('ide')).toBe('mcp server ide crashed during tool call');
  });
});
