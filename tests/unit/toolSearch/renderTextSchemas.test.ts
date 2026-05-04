import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { renderTextSchemas } from '@/tools/toolSearch/renderTextSchemas';
import type { ToolSpec } from '@/tools/types';

function tool(id: string, desc: string): ToolSpec {
  return {
    id,
    description: desc,
    schema: z.object({}),
    parameters: { type: 'object', properties: { x: { type: 'string' } } },
    requiresConfirmation: false,
    source: 'builtin',
    validate: () => ({ ok: true, data: {} }),
    invoke: async () => ({ ok: true, data: {} }),
  };
}

describe('toolSearch.renderTextSchemas', () => {
  it('renders <function>{...}</function> per match', () => {
    const out = renderTextSchemas(['A', 'B'], [tool('A', 'first'), tool('B', 'second')]);
    expect(out.startsWith('<functions>')).toBe(true);
    expect(out.endsWith('</functions>')).toBe(true);
    expect(out).toContain('"name":"A"');
    expect(out).toContain('"name":"B"');
    expect(out).toContain('"description":"first"');
  });

  it('skips matches not in spec list', () => {
    const out = renderTextSchemas(['Missing'], [tool('A', 'first')]);
    expect(out).toBe('<functions>\n</functions>');
  });
});
