export const MAX_RECONNECT_ATTEMPTS = 5;
export const DEFAULT_BASE_MS = 500;
export const DEFAULT_CAP_MS = 16_000;
export const DEFAULT_JITTER = 0.2;
export const SHUTDOWN_SIGTERM_TIMEOUT_MS = 2_000;

export function computeBackoffDelay(
  attempt: number,
  opts: { baseMs?: number; capMs?: number; jitter?: number; random?: () => number } = {},
): number {
  const base = opts.baseMs ?? DEFAULT_BASE_MS;
  const cap = opts.capMs ?? DEFAULT_CAP_MS;
  const jitter = opts.jitter ?? DEFAULT_JITTER;
  const random = opts.random ?? Math.random;
  const raw = Math.min(cap, base * 2 ** attempt);
  const jitterMult = 1 + (random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(raw * jitterMult));
}

export interface ReconnectLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

export interface ReconnectSchedulerOpts {
  readonly serverId: string;
  readonly transport: 'stdio' | 'http';
  readonly logger: ReconnectLogger;
  readonly attempt: () => Promise<boolean>;
  readonly maxAttempts?: number;
  readonly baseMs?: number;
  readonly capMs?: number;
  readonly jitter?: number;
  readonly random?: () => number;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  readonly signal?: AbortSignal;
}

export interface ReconnectHandle {
  readonly promise: Promise<{ ok: boolean; attempts: number }>;
  cancel(): void;
}

export function runReconnectLoop(opts: ReconnectSchedulerOpts): ReconnectHandle {
  const maxAttempts = opts.maxAttempts ?? MAX_RECONNECT_ATTEMPTS;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  let cancelled = false;
  let activeTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveRun: (v: { ok: boolean; attempts: number }) => void = () => undefined;
  const promise = new Promise<{ ok: boolean; attempts: number }>((resolve) => {
    resolveRun = resolve;
  });

  const cancel = (): void => {
    if (cancelled) return;
    cancelled = true;
    if (activeTimer !== null) {
      clearTimeoutFn(activeTimer);
      activeTimer = null;
    }
    resolveRun({ ok: false, attempts: 0 });
  };

  if (opts.signal !== undefined) {
    if (opts.signal.aborted) {
      cancel();
      return { promise, cancel };
    }
    opts.signal.addEventListener('abort', cancel, { once: true });
  }

  opts.logger.warn('mcp.disconnect.observed', {
    serverId: opts.serverId,
    transport: opts.transport,
  });

  let attempt = 0;

  const schedule = (): void => {
    if (cancelled) return;
    if (attempt >= maxAttempts) {
      opts.logger.warn('mcp.reconnect.gaveUp', {
        serverId: opts.serverId,
        transport: opts.transport,
        attempts: attempt,
      });
      resolveRun({ ok: false, attempts: attempt });
      return;
    }
    const delayMs = computeBackoffDelay(attempt, opts);
    opts.logger.info('mcp.reconnect.scheduled', {
      serverId: opts.serverId,
      transport: opts.transport,
      attempt: attempt + 1,
      delayMs,
    });
    activeTimer = setTimeoutFn(async () => {
      activeTimer = null;
      if (cancelled) return;
      attempt += 1;
      opts.logger.info('mcp.reconnect.attempt', {
        serverId: opts.serverId,
        transport: opts.transport,
        attempt,
      });
      const start = Date.now();
      let ok = false;
      try {
        ok = await opts.attempt();
      } catch {
        ok = false;
      }
      if (cancelled) return;
      if (ok) {
        opts.logger.info('mcp.reconnect.ok', {
          serverId: opts.serverId,
          transport: opts.transport,
          attempt,
          durationMs: Date.now() - start,
        });
        resolveRun({ ok: true, attempts: attempt });
        return;
      }
      opts.logger.warn('mcp.reconnect.fail', {
        serverId: opts.serverId,
        transport: opts.transport,
        attempt,
      });
      schedule();
    }, delayMs);
  };

  schedule();

  return { promise, cancel };
}

export interface ChildProcessLike {
  kill(signal: 'SIGTERM' | 'SIGKILL'): boolean;
  readonly pid?: number;
  once(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  removeListener?(event: 'exit', listener: (...args: unknown[]) => void): void;
}

export interface ShutdownSweepOpts {
  readonly serverId: string;
  readonly proc: ChildProcessLike;
  readonly logger: ReconnectLogger;
  readonly timeoutMs?: number;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
}

export async function shutdownStdioChild(opts: ShutdownSweepOpts): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? SHUTDOWN_SIGTERM_TIMEOUT_MS;
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  return new Promise<void>((resolve) => {
    let settled = false;
    const onExit = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeoutFn(timer);
      opts.logger.info('mcp.shutdown.clean', { serverId: opts.serverId });
      resolve();
    };
    opts.proc.once('exit', onExit);
    opts.logger.info('mcp.shutdown.sigterm', { serverId: opts.serverId });
    opts.proc.kill('SIGTERM');
    const timer = setTimeoutFn(() => {
      if (settled) return;
      settled = true;
      opts.logger.warn('mcp.shutdown.sigkill', { serverId: opts.serverId });
      opts.proc.kill('SIGKILL');
      resolve();
    }, timeoutMs);
  });
}

export function crashedToolCallError(serverId: string): string {
  return `mcp server ${serverId} crashed during tool call`;
}
