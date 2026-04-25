import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  wireUserTools,
  USER_TOOLS_RELOAD_COMMAND_ID,
  type UserToolsFileEvents,
  type UserToolEventKind,
} from '@/tools/user/wireUserTools';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { USER_TOOLS_DIR } from '@/tools/user/userToolsLoader';
import { ToolRegistry } from '@/tools/toolRegistry';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

function mkLogger(): Logger {
  const sink: LogSink = {
    write: async (_r: LogRecord) => undefined,
    flush: async () => undefined,
  };
  return new Logger({ level: 'debug', sink });
}

function mkVault(
  init: Record<string, string> = {},
): VaultAdapter & { files: Map<string, string>; folders: Set<string> } {
  const files = new Map<string, string>(Object.entries(init));
  const folders = new Set<string>();
  return {
    files,
    folders,
    async exists(p) {
      return files.has(p) || folders.has(p);
    },
    async mkdir(p) {
      folders.add(p);
    },
    async read(p) {
      const f = files.get(p);
      if (f === undefined) throw new Error(`ENOENT ${p}`);
      return f;
    },
    async write(p, data) {
      files.set(p, data);
    },
    async rename(from, to) {
      const src = files.get(from);
      if (src === undefined) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, src);
    },
    async remove(p) {
      files.delete(p);
    },
    async list(p) {
      const prefix = p.endsWith('/') ? p : `${p}/`;
      const out: string[] = [];
      for (const k of files.keys()) if (k.startsWith(prefix)) out.push(k);
      return { files: out, folders: [] };
    },
  };
}

interface FakeEventSource {
  readonly events: UserToolsFileEvents;
  emit(path: string, kind: UserToolEventKind): void;
  stopCalls: number;
}

function mkEvents(): FakeEventSource {
  let listener: ((p: string, k: UserToolEventKind) => void) | null = null;
  let stopCalls = 0;
  return {
    get stopCalls() {
      return stopCalls;
    },
    events: {
      on(cb) {
        listener = cb;
        return () => {
          stopCalls += 1;
          listener = null;
        };
      },
    },
    emit(path, kind) {
      listener?.(path, kind);
    },
  };
}

function validToolJson(id: string): string {
  return JSON.stringify({
    id,
    description: `d-${id}`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
  });
}

describe('wireUserTools', () => {
  it('loadAll registers every valid declaration on mount', async () => {
    const vault = mkVault({
      [`${USER_TOOLS_DIR}/a.json`]: validToolJson('user-a'),
      [`${USER_TOOLS_DIR}/b.json`]: validToolJson('user-b'),
    });
    const registry = new ToolRegistry({ logger: mkLogger() });
    const wiring = await wireUserTools({ vault, toolRegistry: registry });
    expect(wiring.registeredIds().slice().sort()).toEqual(['user-a', 'user-b']);
    expect(registry.lookup('user-a')).toBeDefined();
    expect(registry.lookup('user-b')).toBeDefined();
  });

  it('skips malformed files without crashing; other tools still register', async () => {
    const vault = mkVault({
      [`${USER_TOOLS_DIR}/broken.json`]: '{not json',
      [`${USER_TOOLS_DIR}/noName.json`]: JSON.stringify({ description: 'x' }),
      [`${USER_TOOLS_DIR}/good.json`]: validToolJson('good'),
    });
    const registry = new ToolRegistry();
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const wiring = await wireUserTools({ vault, toolRegistry: registry, logger });
    expect(wiring.registeredIds()).toEqual(['good']);
    expect(warn).toHaveBeenCalledWith('tool.user.load.error', expect.any(Object));
  });

  it('reload() picks up a new file created under the tools dir', async () => {
    const vault = mkVault({ [`${USER_TOOLS_DIR}/a.json`]: validToolJson('user-a') });
    const events = mkEvents();
    const registry = new ToolRegistry();
    const wiring = await wireUserTools({
      vault,
      toolRegistry: registry,
      fileEvents: events.events,
    });
    expect(wiring.registeredIds()).toEqual(['user-a']);

    vault.files.set(`${USER_TOOLS_DIR}/b.json`, validToolJson('user-b'));
    events.emit(`${USER_TOOLS_DIR}/b.json`, 'create');
    await wiring.reload();

    expect(wiring.registeredIds().slice().sort()).toEqual(['user-a', 'user-b']);
    expect(registry.lookup('user-b')).toBeDefined();
  });

  it('deleting a file unregisters the tool on next reload', async () => {
    const vault = mkVault({
      [`${USER_TOOLS_DIR}/a.json`]: validToolJson('user-a'),
      [`${USER_TOOLS_DIR}/b.json`]: validToolJson('user-b'),
    });
    const events = mkEvents();
    const registry = new ToolRegistry();
    const wiring = await wireUserTools({
      vault,
      toolRegistry: registry,
      fileEvents: events.events,
    });
    vault.files.delete(`${USER_TOOLS_DIR}/b.json`);
    events.emit(`${USER_TOOLS_DIR}/b.json`, 'delete');
    await wiring.reload();
    expect(wiring.registeredIds()).toEqual(['user-a']);
    expect(registry.lookup('user-b')).toBeUndefined();
  });

  it('ignores events outside the tools dir', async () => {
    const vault = mkVault({ [`${USER_TOOLS_DIR}/a.json`]: validToolJson('user-a') });
    const events = mkEvents();
    const registry = new ToolRegistry();
    const wiring = await wireUserTools({
      vault,
      toolRegistry: registry,
      fileEvents: events.events,
    });
    vault.files.set('notes/inert.md', 'hi');
    vault.files.set('other/dir/z.json', validToolJson('should-not-load'));
    events.emit('notes/inert.md', 'modify');
    events.emit('other/dir/z.json', 'create');
    await wiring.reload();
    expect(wiring.registeredIds()).toEqual(['user-a']);
    expect(registry.lookup('should-not-load')).toBeUndefined();
  });

  it('registers a "Leo: Reload user tools" palette command', async () => {
    const vault = mkVault({ [`${USER_TOOLS_DIR}/a.json`]: validToolJson('user-a') });
    const registry = new ToolRegistry();
    const calls: Array<{ id: string; name: string }> = [];
    let registered: null | (() => void | Promise<void>) = null;
    await wireUserTools({
      vault,
      toolRegistry: registry,
      commands: {
        register: (id, name, run) => {
          calls.push({ id, name });
          registered = run;
        },
      },
    });
    expect(calls).toEqual([{ id: USER_TOOLS_RELOAD_COMMAND_ID, name: 'Leo: Reload user tools' }]);
    expect(registered).not.toBeNull();
    vault.files.set(`${USER_TOOLS_DIR}/b.json`, validToolJson('user-b'));
    await registered!();
    expect(registry.lookup('user-b')).toBeDefined();
  });

  it('dispose() unregisters tools and detaches listeners', async () => {
    const vault = mkVault({
      [`${USER_TOOLS_DIR}/a.json`]: validToolJson('user-a'),
      [`${USER_TOOLS_DIR}/b.json`]: validToolJson('user-b'),
    });
    const events = mkEvents();
    const registry = new ToolRegistry();
    const wiring = await wireUserTools({
      vault,
      toolRegistry: registry,
      fileEvents: events.events,
    });
    wiring.dispose();
    expect(wiring.registeredIds()).toEqual([]);
    expect(registry.lookup('user-a')).toBeUndefined();
    expect(registry.lookup('user-b')).toBeUndefined();
    expect(events.stopCalls).toBe(1);
  });

  it('does not collide with existing built-in tool ids', async () => {
    const vault = mkVault({
      [`${USER_TOOLS_DIR}/dup.json`]: validToolJson('read_note'),
    });
    const registry = new ToolRegistry();
    registry.register({
      id: 'read_note',
      description: 'built-in',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: {},
      requiresConfirmation: false,
      source: 'builtin',
      validate: (raw) => ({ ok: true, data: raw }),
      invoke: async () => ({ ok: true, data: {} }),
    });
    const warn = vi.fn();
    const logger = { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() } as unknown as Logger;
    const wiring = await wireUserTools({ vault, toolRegistry: registry, logger });
    expect(wiring.registeredIds()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'tool.user.load.error',
      expect.objectContaining({ error: expect.stringContaining('id collision') }),
    );
  });
});
