import { describe, expect, it } from 'vitest';
import { buildCanvasNode } from '@/agent/canvas/layouts/buildCanvasNode';
import type { Entity } from '@/agent/canvas/schemas';

const SIZE = { width: 200, height: 100 };

function ent(overrides: Partial<Entity> = {}): Entity {
  return { id: 'e1', type: 't', name: 'E1', sources: [], ...overrides };
}

describe('buildCanvasNode', () => {
  it('emits text node with no color when color omitted', () => {
    const node = buildCanvasNode(ent(), 0, 0, SIZE);
    expect(node.type).toBe('text');
    expect((node as { color?: string }).color).toBeUndefined();
  });

  it('emits color when provided', () => {
    const node = buildCanvasNode(ent(), 0, 0, SIZE, '3');
    expect((node as { color: string }).color).toBe('3');
  });

  it('emits file node when entity has filePath', () => {
    const node = buildCanvasNode(ent({ filePath: 'pages/a.md' }), 0, 0, SIZE, '2');
    expect(node.type).toBe('file');
    expect((node as { file: string }).file).toBe('pages/a.md');
    expect((node as { color: string }).color).toBe('2');
  });

  it('omits color when explicitly undefined (round-trips through canvasJson schema)', () => {
    const node = buildCanvasNode(ent(), 0, 0, SIZE, undefined);
    expect(Object.prototype.hasOwnProperty.call(node, 'color')).toBe(false);
  });
});
