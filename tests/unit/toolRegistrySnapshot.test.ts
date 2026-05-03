// Guards the OpenAI tools payload shape emitted by ToolRegistry.toOpenAITools() so
// migrations of the underlying schema source (hand-rolled → zod → future) cannot
// silently change what the model sees.
//
// Tools auto-enumerate via `import.meta.glob` over `src/tools/{*.ts,builtin/*.ts}`,
// so a new builtin factory automatically extends the structural guard surface
// without re-curating a list. The earlier hand-curated registration drifted from
// main.ts and let `delegate_wiki_ingest` ship with a discriminated-union root that
// emitted JSON Schema without `type: "object"`, which LM Studio rejects.
//
// Stub deps are a recursive callable Proxy — every property access yields the same
// callable stub, so destructuring and method-calls during construction are inert.
// Factories invoke deps only inside `invoke(ctx)`, never at build time, so this is
// safe across the entire builtin set.

/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '@/tools/toolRegistry';
import type { ToolSpec } from '@/tools/types';

type StubFn = ((...args: unknown[]) => unknown) & Record<string | symbol, unknown>;

function makeStub(): StubFn {
  const fn = ((): unknown => stub) as StubFn;
  const stub: StubFn = new Proxy(fn, {
    get(_target, key) {
      if (key === 'then') return undefined;
      if (key === Symbol.toPrimitive) return () => 'stub';
      if (key === Symbol.iterator) return undefined;
      return stub;
    },
    apply: () => stub,
  }) as StubFn;
  return stub;
}

type FactoryModule = Record<string, unknown>;

const modules: Record<string, FactoryModule> = {
  ...import.meta.glob<FactoryModule>('../../src/tools/*.ts', { eager: true }),
  ...import.meta.glob<FactoryModule>('../../src/tools/builtin/*.ts', { eager: true }),
};

const factories: ReadonlyArray<{ name: string; factory: (deps: unknown) => unknown }> = (() => {
  const collected: Array<{ name: string; factory: (deps: unknown) => unknown }> = [];
  for (const mod of Object.values(modules)) {
    for (const [exportName, value] of Object.entries(mod)) {
      if (typeof value !== 'function') continue;
      if (!exportName.startsWith('create') || !exportName.endsWith('Tool')) continue;
      collected.push({
        name: exportName,
        factory: value as (deps: unknown) => unknown,
      });
    }
  }
  collected.sort((a, b) => a.name.localeCompare(b.name));
  return collected;
})();

describe('toolRegistry.toOpenAITools — auto-enumerated builtin snapshot', () => {
  const registry = new ToolRegistry();
  const stub = makeStub();
  for (const { factory } of factories) {
    const spec = factory(stub) as ToolSpec<unknown, unknown>;
    registry.register(spec);
  }
  const tools = registry.toOpenAITools('t1');

  it('discovers every builtin factory in src/tools', () => {
    expect(factories.length).toBeGreaterThanOrEqual(16);
    const ids = tools.map((t) => t.function.name);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of tools) expect(t.type).toBe('function');
  });

  it('every tool parameters block is a JSON Schema with type:"object" + properties (LM Studio compatibility)', () => {
    for (const t of tools) {
      const p = t.function.parameters as Record<string, unknown>;
      expect(p.type, `tool ${t.function.name} parameters.type`).toBe('object');
      expect(typeof p.properties, `tool ${t.function.name} parameters.properties`).toBe('object');
      const branches = (p.oneOf ?? p.anyOf) as Array<Record<string, unknown>> | undefined;
      if (branches !== undefined) {
        // discriminated-union root: branches carry additionalProperties; root must not
        // declare additionalProperties:false because that conflicts with branch fields.
        expect(Array.isArray(branches)).toBe(true);
      } else {
        expect(p.additionalProperties, `tool ${t.function.name} additionalProperties`).toBe(false);
      }
    }
  });

  it('path-accepting tools require path and declare it as a string', () => {
    for (const id of [
      'read_note',
      'create_note',
      'append_to_note',
      'create_folder',
      'edit_note',
      'rename_note',
      'move_note',
      'copy_note',
      'delete_note',
      'delete_folder',
    ]) {
      const t = tools.find((x) => x.function.name === id);
      expect(t, `expected tool ${id} to be auto-discovered`).toBeDefined();
      if (t === undefined) continue;
      const p = t.function.parameters as {
        properties: { path: { type: string } };
        required: readonly string[];
      };
      expect(p.properties.path.type).toBe('string');
      expect(p.required).toContain('path');
    }
  });

  it('rename/move/copy require both path and new_path', () => {
    for (const id of ['rename_note', 'move_note', 'copy_note']) {
      const t = tools.find((x) => x.function.name === id)!;
      const p = t.function.parameters as {
        properties: { path: { type: string }; new_path: { type: string } };
        required: readonly string[];
      };
      expect(p.properties.new_path.type).toBe('string');
      expect(p.required).toContain('path');
      expect(p.required).toContain('new_path');
    }
  });

  it('edit_note requires the four editor args', () => {
    const t = tools.find((x) => x.function.name === 'edit_note')!;
    const p = t.function.parameters as { required: readonly string[] };
    expect([...p.required].sort()).toEqual(
      ['line_end', 'line_start', 'new_content', 'path'].sort(),
    );
  });

  it('search_vault exposes query (required) + tags (optional array of strings)', () => {
    const t = tools.find((x) => x.function.name === 'search_vault')!;
    const p = t.function.parameters as {
      properties: { query: { type: string }; tags?: { type: string; items: { type: string } } };
      required: readonly string[];
    };
    expect(p.properties.query.type).toBe('string');
    expect(p.required).toContain('query');
    expect(p.required).not.toContain('tags');
    expect(p.properties.tags?.type).toBe('array');
    expect(p.properties.tags?.items.type).toBe('string');
  });

  it('descriptions are preserved from the tool spec', () => {
    const read = tools.find((x) => x.function.name === 'read_note')!;
    expect(read.function.description).toContain('Read the contents');
    const edit = tools.find((x) => x.function.name === 'edit_note')!;
    expect(edit.function.description).toContain('Replace a line range');
  });

  it('discovers the new wiki tools (regression guard for hand-curated drift)', () => {
    const ids = new Set(tools.map((t) => t.function.name));
    for (const id of ['delegate_wiki_ingest', 'delegate_wiki_lint', 'inbox_add', 'search_wiki']) {
      expect(ids, `auto-enumeration must include ${id}`).toContain(id);
    }
  });
});
