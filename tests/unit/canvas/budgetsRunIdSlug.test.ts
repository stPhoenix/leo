import { describe, expect, it } from 'vitest';
import { CANVAS_BUDGETS } from '@/agent/canvas/budgets';
import { generateCanvasRunId } from '@/agent/canvas/runIdRegistry';
import { canvasPathToSidecarSlug, parseSidecarSlug } from '@/agent/canvas/slug';

describe('CANVAS_BUDGETS', () => {
  it('exposes expected NFR-CANVAS-10 values', () => {
    expect(CANVAS_BUDGETS.extractorChunkSizeTokens).toBe(4000);
    expect(CANVAS_BUDGETS.extractorChunkOverlapTokens).toBe(200);
    expect(CANVAS_BUDGETS.chunksPerSourceMax).toBe(20);
    expect(CANVAS_BUDGETS.chunkConcurrency).toBe(2);
    expect(CANVAS_BUDGETS.extractorOutputCap).toBe(1500);
    expect(CANVAS_BUDGETS.reducerInputCap).toBe(6000);
    expect(CANVAS_BUDGETS.reducerOutputCap).toBe(2500);
    expect(CANVAS_BUDGETS.refineInputCap).toBe(4000);
    expect(CANVAS_BUDGETS.refineOutputCap).toBe(1500);
    expect(CANVAS_BUDGETS.MOVE_DRIFT_PX).toBe(16);
    expect(CANVAS_BUDGETS.freeSpacePadPx).toBe(80);
    expect(CANVAS_BUDGETS.bboxPadding).toBe(80);
    expect(CANVAS_BUDGETS.sourceFanoutMax).toBe(200);
    expect(CANVAS_BUDGETS.extractorConcurrency).toBe(1);
    expect(CANVAS_BUDGETS.refineClarifyMax).toBe(3);
    expect(CANVAS_BUDGETS.editIterationsMax).toBe(3);
  });
});

describe('generateCanvasRunId', () => {
  it('formats YYYYMMDD-HHmmss-<tail> deterministically', () => {
    const fixed = new Date(2026, 4, 5, 19, 38, 24);
    const id = generateCanvasRunId({ now: () => fixed, tail: () => 'abcdef' });
    expect(id).toBe('20260505-193824-abcdef');
  });

  it('default tail is 6 chars', () => {
    const id = generateCanvasRunId({ now: () => new Date(2026, 0, 1, 0, 0, 0) });
    expect(id).toMatch(/^20260101-000000-[0-9a-z]{6}$/);
  });
});

describe('canvasPathToSidecarSlug', () => {
  it('produces kebab leaf + 6-hex SHA-256 suffix', async () => {
    const slug = await canvasPathToSidecarSlug('canvases/conf-2026-q1.canvas');
    expect(slug).toMatch(/^conf-2026-q1-[0-9a-f]{6}$/);
  });

  it('is deterministic across calls', async () => {
    const a = await canvasPathToSidecarSlug('canvases/foo.canvas');
    const b = await canvasPathToSidecarSlug('canvases/foo.canvas');
    expect(a).toBe(b);
  });

  it('distinct paths sharing leaf produce different slugs', async () => {
    const a = await canvasPathToSidecarSlug('a/notes.canvas');
    const b = await canvasPathToSidecarSlug('b/notes.canvas');
    expect(a).not.toBe(b);
  });

  it('normalizes spaces and unicode; never contains "/" or ".."', async () => {
    const slug = await canvasPathToSidecarSlug('canvases/Café  Plan.canvas');
    expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('..');
  });

  it('falls back to "canvas" prefix when leaf normalizes to empty', async () => {
    const slug = await canvasPathToSidecarSlug('canvases/____.canvas');
    expect(slug).toMatch(/^canvas-[0-9a-f]{6}$/);
  });
});

describe('parseSidecarSlug', () => {
  it('parses round-trip', async () => {
    const slug = await canvasPathToSidecarSlug('canvases/foo.canvas');
    const parsed = parseSidecarSlug(slug);
    expect(parsed?.leaf).toBe('foo');
    expect(parsed?.suffix).toMatch(/^[0-9a-f]{6}$/);
  });

  it('returns null for malformed', () => {
    expect(parseSidecarSlug('no-suffix')).toBeNull();
  });
});
