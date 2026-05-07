import { describe, expect, it } from 'vitest';
import { CANVAS_NODE_SIZING } from '@/agent/canvas/budgets';
import { nodeSizeFor } from '@/agent/canvas/layouts/nodeSize';

describe('nodeSizeFor — text kind', () => {
  it('respects text-kind clamps', () => {
    const tiny = nodeSizeFor({ type: 't', name: 'x' });
    expect(tiny.width).toBe(CANVAS_NODE_SIZING.textWidthMin);
    expect(tiny.height).toBeGreaterThanOrEqual(CANVAS_NODE_SIZING.textHeightMin);

    const huge = nodeSizeFor({ type: 't', name: 'x'.repeat(500) });
    expect(huge.width).toBe(CANVAS_NODE_SIZING.textWidthMax);
  });
});

describe('nodeSizeFor — file kind', () => {
  it('uses larger floors when entity has filePath', () => {
    const file = nodeSizeFor({ type: 'note', name: 'short', filePath: 'wiki/pages/x.md' });
    expect(file.width).toBeGreaterThanOrEqual(CANVAS_NODE_SIZING.fileWidthMin);
    expect(file.height).toBeGreaterThanOrEqual(CANVAS_NODE_SIZING.fileHeightMin);
  });

  it('clamps file-kind width and height to file-kind max', () => {
    const huge = nodeSizeFor({
      type: 'note',
      name: 'x'.repeat(500),
      filePath: 'wiki/pages/big.md',
    });
    expect(huge.width).toBe(CANVAS_NODE_SIZING.fileWidthMax);
    expect(huge.height).toBeLessThanOrEqual(CANVAS_NODE_SIZING.fileHeightMax);
  });

  it('empty filePath string falls back to text kind', () => {
    const result = nodeSizeFor({ type: 't', name: 'x', filePath: '' });
    expect(result.width).toBe(CANVAS_NODE_SIZING.textWidthMin);
  });
});
