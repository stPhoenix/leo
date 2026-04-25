import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { makeToolCtx } from './_toolCtx';
import {
  buildSpec,
  loadUserTools,
  parseDeclaration,
  type ToolRegistryLike,
  type UserToolDeclaration,
} from '@/tools/user/userToolsLoader';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ToolCtx, ToolSpec } from '@/tools/types';

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

function mkRegistry(prefilled: string[] = []): ToolRegistryLike & {
  registrations: Map<string, ToolSpec<unknown, unknown>>;
} {
  const registrations = new Map<string, ToolSpec<unknown, unknown>>();
  for (const id of prefilled) {
    registrations.set(id, {
      id,
      description: 'builtin',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: {},
      requiresConfirmation: false,
      source: 'builtin',
      validate: (raw) => ({ ok: true, data: raw }),
      invoke: async () => ({ ok: true, data: {} }),
    });
  }
  return {
    registrations,
    register(spec) {
      registrations.set(spec.id, spec);
    },
    lookup(id) {
      return registrations.get(id);
    },
  };
}

function mkCtx(signal: AbortSignal = new AbortController().signal): ToolCtx {
  return makeToolCtx({ thread: 't1', signal });
}

describe('parseDeclaration', () => {
  const minimal = {
    id: 'my-tool',
    description: 'does things',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
  } as const;

  it('accepts a valid vault-op read declaration', () => {
    const r = parseDeclaration(minimal);
    expect(r.ok).toBe(true);
  });

  it('accepts a vault-op create/append with contentArg', () => {
    const r = parseDeclaration({
      ...minimal,
      impl: { kind: 'vault-op', op: 'create', pathArg: 'path', contentArg: 'content' },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects vault-op create without contentArg', () => {
    const r = parseDeclaration({
      ...minimal,
      impl: { kind: 'vault-op', op: 'create', pathArg: 'path' },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid js declaration', () => {
    const r = parseDeclaration({
      ...minimal,
      impl: { kind: 'js', source: 'return {ok:true, data:{}}' },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects missing id / description / parameters / impl', () => {
    expect(parseDeclaration({}).ok).toBe(false);
    expect(parseDeclaration({ id: 'x' }).ok).toBe(false);
    expect(parseDeclaration({ id: 'x', description: 'y' }).ok).toBe(false);
    expect(parseDeclaration({ id: 'x', description: 'y', parameters: {} }).ok).toBe(false);
  });

  it('rejects unknown impl.kind', () => {
    expect(parseDeclaration({ ...minimal, impl: { kind: 'shell', cmd: 'rm' } as never }).ok).toBe(
      false,
    );
  });

  it('rejects non-boolean requiresConfirmation', () => {
    expect(parseDeclaration({ ...minimal, requiresConfirmation: 'yes' } as never).ok).toBe(false);
  });
});

describe('buildSpec default confirmation semantics', () => {
  const vault = mkVault();

  function decl(impl: UserToolDeclaration['impl'], rc?: boolean): UserToolDeclaration {
    return {
      id: 'x',
      description: 'y',
      parameters: {},
      ...(rc !== undefined ? { requiresConfirmation: rc } : {}),
      impl,
    };
  }

  it('vault-op write/append defaults to requiresConfirmation: true', () => {
    const spec = buildSpec(
      decl({ kind: 'vault-op', op: 'create', pathArg: 'path', contentArg: 'content' }),
      { vault, registry: mkRegistry() },
    );
    expect(spec.requiresConfirmation).toBe(true);
  });

  it('vault-op read defaults to false', () => {
    const spec = buildSpec(decl({ kind: 'vault-op', op: 'read', pathArg: 'path' }), {
      vault,
      registry: mkRegistry(),
    });
    expect(spec.requiresConfirmation).toBe(false);
  });

  it('vault-op read can opt into true', () => {
    const spec = buildSpec(decl({ kind: 'vault-op', op: 'read', pathArg: 'path' }, true), {
      vault,
      registry: mkRegistry(),
    });
    expect(spec.requiresConfirmation).toBe(true);
  });

  it('js declarations are ALWAYS requiresConfirmation: true regardless of declared value', () => {
    const spec = buildSpec(decl({ kind: 'js', source: 'return {ok:true}' }, false), {
      vault,
      registry: mkRegistry(),
    });
    expect(spec.requiresConfirmation).toBe(true);
  });
});

describe('vault-op invoke', () => {
  it('read: returns {content} on success', async () => {
    const vault = mkVault({ 'notes/a.md': 'body' });
    const spec = buildSpec(
      {
        id: 'read-a',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: 'notes/a.md' }, mkCtx());
    expect(res).toEqual({ ok: true, data: { path: 'notes/a.md', content: 'body' } });
  });

  it('read: unknown path → not found error', async () => {
    const vault = mkVault();
    const spec = buildSpec(
      {
        id: 'read',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: 'gone.md' }, mkCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('not found');
  });

  it('create: writes content and returns {bytes, op}', async () => {
    const vault = mkVault();
    const spec = buildSpec(
      {
        id: 'c',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'create', pathArg: 'path', contentArg: 'content' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: 'new.md', content: 'hi' }, mkCtx());
    expect(res.ok).toBe(true);
    expect(vault.files.get('new.md')).toBe('hi');
  });

  it('create: path-traversal guard rejects `..`', async () => {
    const vault = mkVault();
    const spec = buildSpec(
      {
        id: 'c',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'create', pathArg: 'path', contentArg: 'content' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: '../evil.md', content: 'x' }, mkCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('unsafe path');
  });

  it('create: rejects leading slash', async () => {
    const vault = mkVault();
    const spec = buildSpec(
      {
        id: 'c',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'create', pathArg: 'path', contentArg: 'content' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: '/absolute.md', content: 'x' }, mkCtx());
    expect(res.ok).toBe(false);
  });

  it('append: concatenates with a newline separator on existing file', async () => {
    const vault = mkVault({ 'notes/log.md': 'line1' });
    const spec = buildSpec(
      {
        id: 'a',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'append', pathArg: 'path', contentArg: 'content' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: 'notes/log.md', content: 'line2' }, mkCtx());
    expect(res.ok).toBe(true);
    expect(vault.files.get('notes/log.md')).toBe('line1\nline2');
  });

  it('pre-aborted signal returns {ok:false, error:"aborted"} without side-effects', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const vault = mkVault();
    const spec = buildSpec(
      {
        id: 'c',
        description: '',
        parameters: {},
        impl: { kind: 'vault-op', op: 'create', pathArg: 'path', contentArg: 'content' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ path: 'x.md', content: 'y' }, mkCtx(ctl.signal));
    expect(res).toEqual({ ok: false, error: 'aborted' });
    expect(vault.files.has('x.md')).toBe(false);
  });
});

describe('js impl invoke', () => {
  const vault = mkVault();

  it('happy path: returned value becomes data when no {ok} wrapper', async () => {
    const spec = buildSpec(
      {
        id: 'j',
        description: '',
        parameters: {},
        impl: { kind: 'js', source: 'return args.a + args.b' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ a: 2, b: 3 }, mkCtx());
    expect(res).toEqual({ ok: true, data: 5 });
  });

  it('respects a {ok:true, data} wrapper returned from the snippet', async () => {
    const spec = buildSpec(
      {
        id: 'j',
        description: '',
        parameters: {},
        impl: { kind: 'js', source: 'return {ok:true, data:{result: args.x}}' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({ x: 'wrapped' }, mkCtx());
    expect(res).toEqual({ ok: true, data: { result: 'wrapped' } });
  });

  it('thrown errors coerce to {ok:false, error}', async () => {
    const spec = buildSpec(
      {
        id: 'j',
        description: '',
        parameters: {},
        impl: { kind: 'js', source: 'throw new Error("boom")' },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({}, mkCtx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('boom');
  });

  it('pre-aborted signal returns {ok:false, error:"aborted"} without running the snippet', async () => {
    const spec = buildSpec(
      {
        id: 'j',
        description: '',
        parameters: {},
        impl: { kind: 'js', source: 'throw new Error("should not run")' },
      },
      { vault, registry: mkRegistry() },
    );
    const ctl = new AbortController();
    ctl.abort();
    const res = await spec.invoke({}, mkCtx(ctl.signal));
    expect(res).toEqual({ ok: false, error: 'aborted' });
  });

  it('sandbox ctx exposes vault + signal but NOT app / window / require / fetch', async () => {
    const spec = buildSpec(
      {
        id: 'j',
        description: '',
        parameters: {},
        impl: {
          kind: 'js',
          source: `
            const keys = Object.keys(ctx).sort();
            const hasApp = typeof ctx.app !== 'undefined';
            const hasWindow = typeof ctx.window !== 'undefined';
            const hasRequire = typeof ctx.require !== 'undefined';
            const hasFetch = typeof ctx.fetch !== 'undefined';
            return {ok:true, data:{keys, hasApp, hasWindow, hasRequire, hasFetch}};
          `,
        },
      },
      { vault, registry: mkRegistry() },
    );
    const res = await spec.invoke({}, mkCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      const data = res.data as {
        keys: string[];
        hasApp: boolean;
        hasWindow: boolean;
        hasRequire: boolean;
        hasFetch: boolean;
      };
      expect(data.keys).toEqual(expect.arrayContaining(['signal', 'vault']));
      expect(data.hasApp).toBe(false);
      expect(data.hasWindow).toBe(false);
      expect(data.hasRequire).toBe(false);
      expect(data.hasFetch).toBe(false);
    }
  });
});

describe('loadUserTools', () => {
  it('scans .leo/tools/*.json and registers valid declarations', async () => {
    const vault = mkVault({
      '.leo/tools/a.json': JSON.stringify({
        id: 'a',
        description: 'A',
        parameters: {},
        impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
      }),
      '.leo/tools/b.json': JSON.stringify({
        id: 'b',
        description: 'B',
        parameters: {},
        impl: { kind: 'js', source: 'return 42' },
      }),
      '.leo/tools/c.txt': 'ignored',
    });
    const registry = mkRegistry();
    const n = await loadUserTools({ vault, registry });
    expect(n).toBe(2);
    expect(registry.registrations.size).toBe(2);
  });

  it('skips invalid declarations and logs tool.user.load.error', async () => {
    const vault = mkVault({
      '.leo/tools/bad.json': '{not-valid-json',
      '.leo/tools/also-bad.json': JSON.stringify({ description: 'missing id' }),
      '.leo/tools/good.json': JSON.stringify({
        id: 'g',
        description: 'G',
        parameters: {},
        impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
      }),
    });
    const registry = mkRegistry();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const notice = { notify: vi.fn() };
    const n = await loadUserTools({ vault, registry, logger: logger as never, notice });
    expect(n).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('tool.user.load.error', expect.any(Object));
    expect(notice.notify).toHaveBeenCalled();
  });

  it('rejects id collisions with pre-existing registrations', async () => {
    const vault = mkVault({
      '.leo/tools/read-note.json': JSON.stringify({
        id: 'read_note',
        description: 'collides',
        parameters: {},
        impl: { kind: 'vault-op', op: 'read', pathArg: 'path' },
      }),
    });
    const registry = mkRegistry(['read_note']);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const n = await loadUserTools({ vault, registry, logger: logger as never });
    expect(n).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'tool.user.load.error',
      expect.objectContaining({ error: expect.stringContaining('id collision') }),
    );
  });
});
