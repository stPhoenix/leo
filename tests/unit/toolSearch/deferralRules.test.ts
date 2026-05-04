import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { isDeferred, partitionTools } from '@/tools/toolSearch/deferralRules';
import type { ToolSpec } from '@/tools/types';

function tool(id: string, opts: Partial<ToolSpec> = {}): ToolSpec {
  return {
    id,
    description: '',
    schema: z.object({}),
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    source: 'builtin',
    validate: () => ({ ok: true, data: {} }),
    invoke: async () => ({ ok: true, data: {} }),
    ...opts,
  } as ToolSpec;
}

describe('toolSearch.deferralRules', () => {
  const ctx = { toolSearchToolId: 'ToolSearch' };

  it('alwaysLoad never defers even if isMcp', () => {
    const t = tool('mcp.x.y', { isMcp: true, alwaysLoad: true });
    expect(isDeferred(t, ctx)).toBe(false);
  });

  it('ToolSearch itself never defers', () => {
    const t = tool('ToolSearch');
    expect(isDeferred(t, ctx)).toBe(false);
  });

  it('mcp tools defer by default', () => {
    expect(isDeferred(tool('mcp.foo.bar', { isMcp: true }), ctx)).toBe(true);
  });

  it('shouldDefer flag opts non-mcp tools in', () => {
    expect(isDeferred(tool('SomeTool', { shouldDefer: true }), ctx)).toBe(true);
  });

  it('regular tools do not defer', () => {
    expect(isDeferred(tool('Read'), ctx)).toBe(false);
  });

  it('partitionTools includes discovered, defers undiscovered', () => {
    const specs = [
      tool('Read'),
      tool('ToolSearch'),
      tool('mcp.a.b', { isMcp: true }),
      tool('mcp.c.d', { isMcp: true }),
    ];
    const part = partitionTools(specs, new Set(['mcp.a.b']), ctx);
    const includedIds = part.included.map((s) => s.id);
    expect(includedIds).toContain('Read');
    expect(includedIds).toContain('ToolSearch');
    expect(includedIds).toContain('mcp.a.b');
    expect(includedIds).not.toContain('mcp.c.d');
    expect([...part.deferLoading]).toEqual(['mcp.c.d']);
  });
});
