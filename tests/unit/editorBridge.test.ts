import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorBridge, type EditorFocusProbe, type PluginLike } from '@/editor/editorBridge';
import type { FocusedContext, FocusedContextSink } from '@/editor/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

interface HandlerRecord {
  readonly name: string;
  readonly handler: (...args: unknown[]) => void;
  detached: boolean;
}

interface FakeEventRef {
  readonly record: HandlerRecord;
}

class FakeWorkspace {
  readonly handlers: HandlerRecord[] = [];

  on(name: string, handler: (...args: unknown[]) => void): FakeEventRef {
    const record: HandlerRecord = { name, handler, detached: false };
    this.handlers.push(record);
    return { record };
  }

  off(_name: string, handler: (...args: unknown[]) => void): void {
    const match = this.handlers.find((h) => h.handler === handler && !h.detached);
    if (match) match.detached = true;
  }

  offref(ref: FakeEventRef): void {
    ref.record.detached = true;
  }

  emit(name: string, ...args: unknown[]): void {
    for (const h of this.handlers) {
      if (h.detached) continue;
      if (h.name === name) h.handler(...args);
    }
  }

  countActive(name: string): number {
    return this.handlers.filter((h) => h.name === name && !h.detached).length;
  }
}

class FakePlugin {
  readonly app = { workspace: new FakeWorkspace() };
  readonly editorExtensions: unknown[] = [];
  readonly registeredRefs: FakeEventRef[] = [];

  registerEvent(ref: FakeEventRef): void {
    this.registeredRefs.push(ref);
  }

  registerEditorExtension(ext: unknown): void {
    this.editorExtensions.push(ext);
  }

  simulateUnload(): void {
    for (const ref of this.registeredRefs) {
      this.app.workspace.offref(ref);
    }
  }
}

class FakeSink implements FocusedContextSink {
  readonly events: FocusedContext[] = [];
  push(ctx: FocusedContext): void {
    this.events.push(ctx);
  }
}

class FakeProbe implements EditorFocusProbe {
  observed = 0;
  leafChanges = 0;
  fileOpens = 0;
  current: FocusedContext = NULL_FOCUSED_CONTEXT;

  observeView(): void {
    this.observed += 1;
  }
  onLeafChange(): void {
    this.leafChanges += 1;
  }
  onFileOpen(): void {
    this.fileOpens += 1;
  }
  read(): FocusedContext {
    return this.current;
  }
  setContext(ctx: FocusedContext): void {
    this.current = ctx;
  }
}

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {
      /* no-op */
    },
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

function setup(opts: { debounceMs?: number } = {}): {
  plugin: FakePlugin;
  sink: FakeSink;
  probe: FakeProbe;
  bridge: EditorBridge;
  records: LogRecord[];
} {
  const plugin = new FakePlugin();
  const sink = new FakeSink();
  const probe = new FakeProbe();
  const { logger, records } = makeLogger();
  const bridge = new EditorBridge({
    plugin: plugin as unknown as PluginLike,
    sink,
    logger,
    probe,
    debounceMs: opts.debounceMs ?? 300,
  });
  bridge.start();
  return { plugin, sink, probe, bridge, records };
}

const richContext: FocusedContext = {
  file: 'Notes/Example.md',
  cursor: { line: 10, ch: 3 },
  selection: { from: { line: 10, ch: 0 }, to: { line: 10, ch: 3 } },
  viewport: { from: 5, to: 80, text: 'viewport content' },
};

describe('EditorBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits initial snapshot on start, plus extension registered', () => {
    const { plugin, sink, probe } = setup();
    expect(plugin.editorExtensions.length).toBe(1);
    expect(sink.events.length).toBe(1);
    expect(sink.events[0]).toEqual(NULL_FOCUSED_CONTEXT);
    expect(probe.observed).toBe(0);
  });

  it('registers active-leaf-change, file-open, editor-change listeners', () => {
    const { plugin } = setup();
    const ws = plugin.app.workspace;
    expect(ws.countActive('active-leaf-change')).toBe(1);
    expect(ws.countActive('file-open')).toBe(1);
    expect(ws.countActive('editor-change')).toBe(1);
    expect(plugin.registeredRefs.length).toBe(3);
  });

  it('debounces bursts of notify() calls into a single emission at 300ms', () => {
    const { sink, bridge, probe } = setup();
    probe.setContext(richContext);
    sink.events.length = 0;
    for (let i = 0; i < 20; i += 1) {
      bridge.notify();
      vi.advanceTimersByTime(10);
    }
    expect(sink.events.length).toBe(0);
    vi.advanceTimersByTime(300);
    expect(sink.events.length).toBe(1);
    expect(sink.events[0]).toEqual(richContext);
  });

  it('enforces ≤ 1 emission per 300ms window across 1s burst', () => {
    const { sink, bridge } = setup();
    sink.events.length = 0;
    const start = 0;
    const end = 1000;
    for (let t = start; t < end; t += 10) {
      bridge.notify();
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(300);
    expect(sink.events.length).toBeLessThanOrEqual(Math.ceil(1000 / 300) + 1);
    expect(sink.events.length).toBeGreaterThanOrEqual(1);
  });

  it('delivers the last context of a burst (trailing edge)', () => {
    const { sink, bridge, probe } = setup();
    sink.events.length = 0;
    probe.setContext({ ...richContext, cursor: { line: 1, ch: 1 } });
    bridge.notify();
    probe.setContext({ ...richContext, cursor: { line: 2, ch: 2 } });
    bridge.notify();
    probe.setContext({ ...richContext, cursor: { line: 3, ch: 3 } });
    bridge.notify();
    vi.advanceTimersByTime(300);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.cursor).toEqual({ line: 3, ch: 3 });
  });

  it('active-leaf-change calls probe.onLeafChange and emits immediately, cancelling pending debounce', () => {
    const { plugin, sink, probe, bridge } = setup();
    sink.events.length = 0;
    probe.setContext(richContext);
    bridge.notify();
    expect(sink.events).toHaveLength(0);
    plugin.app.workspace.emit('active-leaf-change', null);
    expect(probe.leafChanges).toBe(1);
    expect(sink.events).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(sink.events).toHaveLength(1);
  });

  it('file-open calls probe.onFileOpen and emits immediately', () => {
    const { plugin, sink, probe, bridge } = setup();
    sink.events.length = 0;
    probe.setContext(richContext);
    bridge.notify();
    plugin.app.workspace.emit('file-open', null);
    expect(probe.fileOpens).toBe(1);
    expect(sink.events).toHaveLength(1);
    vi.advanceTimersByTime(400);
    expect(sink.events).toHaveLength(1);
  });

  it('editor-change goes through debounce and does not double-fire alongside notify()', () => {
    const { plugin, sink, bridge, probe } = setup();
    sink.events.length = 0;
    probe.setContext(richContext);
    for (let i = 0; i < 5; i += 1) {
      bridge.notify();
      plugin.app.workspace.emit('editor-change', {}, {});
      vi.advanceTimersByTime(10);
    }
    expect(sink.events).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(sink.events).toHaveLength(1);
  });

  it('emits a complete payload with all four fields', () => {
    const { sink, probe, bridge } = setup();
    sink.events.length = 0;
    probe.setContext(richContext);
    bridge.notify();
    vi.advanceTimersByTime(300);
    expect(sink.events).toHaveLength(1);
    const ctx = sink.events[0]!;
    expect(ctx.file).toBe('Notes/Example.md');
    expect(ctx.cursor).toEqual({ line: 10, ch: 3 });
    expect(ctx.selection).toEqual({
      from: { line: 10, ch: 0 },
      to: { line: 10, ch: 3 },
    });
    expect(ctx.viewport).toEqual({ from: 5, to: 80, text: 'viewport content' });
  });

  it('emits NULL payload when probe reports no active markdown editor', () => {
    const { plugin, sink, probe } = setup();
    sink.events.length = 0;
    probe.setContext(NULL_FOCUSED_CONTEXT);
    plugin.app.workspace.emit('active-leaf-change', null);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toEqual(NULL_FOCUSED_CONTEXT);
  });

  it('listeners teardown on simulated unload; post-unload emissions are inert', () => {
    const { plugin, sink, bridge } = setup();
    sink.events.length = 0;
    plugin.simulateUnload();
    bridge.dispose();
    expect(plugin.app.workspace.countActive('active-leaf-change')).toBe(0);
    expect(plugin.app.workspace.countActive('file-open')).toBe(0);
    expect(plugin.app.workspace.countActive('editor-change')).toBe(0);
    plugin.app.workspace.emit('active-leaf-change', null);
    plugin.app.workspace.emit('file-open', null);
    plugin.app.workspace.emit('editor-change', {}, {});
    expect(sink.events).toHaveLength(0);
  });

  it('dispose cancels pending debounce so no trailing emission after unload', () => {
    const { sink, bridge, probe } = setup();
    sink.events.length = 0;
    probe.setContext(richContext);
    bridge.notify();
    bridge.dispose();
    vi.advanceTimersByTime(400);
    expect(sink.events).toHaveLength(0);
  });

  it('logs structured editor.focus event on every emission', () => {
    const { records, bridge, probe } = setup();
    records.length = 0;
    probe.setContext(richContext);
    bridge.notify();
    vi.advanceTimersByTime(300);
    const entry = records.find((r) => r.event === 'editor.focus');
    expect(entry).toBeDefined();
    expect(entry?.level).toBe('debug');
    expect(entry?.fields.source).toBe('debounced');
    expect(entry?.fields.file).toBe('Notes/Example.md');
    expect(entry?.fields.hasCursor).toBe(true);
    expect(entry?.fields.hasSelection).toBe(true);
  });

  it('microbenchmark: emit path stays well under 5ms budget at p95 across 200 iterations', () => {
    vi.useRealTimers();
    const { sink, bridge, probe } = setup();
    sink.events.length = 0;
    probe.setContext(richContext);
    const N = 200;
    const samples: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const t0 = performance.now();
      bridge.flush();
      bridge.notify();
      bridge.flush();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(N * 0.95)]!;
    expect(p95).toBeLessThan(5);
  });
});
