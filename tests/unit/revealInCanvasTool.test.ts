import { describe, expect, it, vi } from 'vitest';
import { createRevealInCanvasTool } from '@/agent/canvas/tools/revealInCanvas';
import type { CanvasBbox, CanvasNavigator } from '@/editor/canvasNavigator';
import type { WorkspaceLeaf } from 'obsidian';
import { InMemoryVaultAdapter } from '../helpers/inMemoryVaultAdapter';
import { makeToolCtx } from './_toolCtx';

function fakeNavigator(opts?: { panOk?: boolean; openErr?: string }): {
  navigator: CanvasNavigator;
  panCalls: { bbox: CanvasBbox; padding: number }[];
} {
  const panCalls: { bbox: CanvasBbox; padding: number }[] = [];
  const stubLeaf = {} as WorkspaceLeaf;
  const openCanvas: CanvasNavigator['openCanvas'] = async (_path) => {
    if (opts?.openErr !== undefined) return { ok: false, error: opts.openErr };
    return { ok: true, leaf: stubLeaf };
  };
  const panZoomToBbox: CanvasNavigator['panZoomToBbox'] = (_leaf, bbox, padding) => {
    panCalls.push({ bbox, padding });
    return opts?.panOk ?? true;
  };
  return {
    navigator: {
      openCanvas: vi.fn(openCanvas),
      panZoomToBbox: vi.fn(panZoomToBbox),
    },
    panCalls,
  };
}

const sampleCanvas = JSON.stringify({
  nodes: [
    { type: 'text', id: 'a', x: 0, y: 0, width: 100, height: 50, text: 't' },
    { type: 'text', id: 'b', x: 200, y: 100, width: 80, height: 40, text: 'u' },
    { type: 'file', id: 'c', x: 400, y: 0, width: 120, height: 60, file: 'F.md' },
  ],
  edges: [],
});

describe('reveal_in_canvas tool — shape', () => {
  it('declares id, isReadOnly=true, requiresConfirmation=false', () => {
    const tool = createRevealInCanvasTool();
    expect(tool.id).toBe('reveal_in_canvas');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.parameters).toEqual(expect.objectContaining({ type: 'object' }));
  });
});

describe('reveal_in_canvas tool — invocation', () => {
  it('happy path with bbox: viewportApplied=true', async () => {
    const { navigator, panCalls } = fakeNavigator({ panOk: true });
    const vault = new InMemoryVaultAdapter();
    await vault.write('canvases/x.canvas', sampleCanvas);
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', bbox: { x: 10, y: 20, w: 30, h: 40 } },
      makeToolCtx({ vault, canvasNavigator: navigator }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.viewportApplied).toBe(true);
    expect(result.data.warning).toBeUndefined();
    expect(panCalls).toHaveLength(1);
    expect(panCalls[0]!.bbox).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(panCalls[0]!.padding).toBe(80);
  });

  it('falls back when navigator panZoom returns false: ok+warning', async () => {
    const { navigator } = fakeNavigator({ panOk: false });
    const vault = new InMemoryVaultAdapter();
    await vault.write('canvases/x.canvas', sampleCanvas);
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', bbox: { x: 0, y: 0, w: 1, h: 1 } },
      makeToolCtx({ vault, canvasNavigator: navigator }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.viewportApplied).toBe(false);
    expect(result.data.warning).toBe('reveal_unsupported_in_this_obsidian_version');
  });

  it('nodeIds: computes union bbox across known nodes; unknown ids skipped', async () => {
    const { navigator, panCalls } = fakeNavigator({ panOk: true });
    const vault = new InMemoryVaultAdapter();
    await vault.write('canvases/x.canvas', sampleCanvas);
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', nodeIds: ['a', 'b', 'missing'] },
      makeToolCtx({ vault, canvasNavigator: navigator }),
    );
    expect(result.ok).toBe(true);
    expect(panCalls).toHaveLength(1);
    expect(panCalls[0]!.bbox).toEqual({ x: 0, y: 0, w: 280, h: 140 });
  });

  it('bbox takes precedence over nodeIds when both supplied', async () => {
    const { navigator, panCalls } = fakeNavigator({ panOk: true });
    const vault = new InMemoryVaultAdapter();
    await vault.write('canvases/x.canvas', sampleCanvas);
    const tool = createRevealInCanvasTool();
    await tool.invoke(
      {
        path: 'canvases/x.canvas',
        bbox: { x: 999, y: 999, w: 1, h: 1 },
        nodeIds: ['a', 'b'],
      },
      makeToolCtx({ vault, canvasNavigator: navigator }),
    );
    expect(panCalls[0]!.bbox).toEqual({ x: 999, y: 999, w: 1, h: 1 });
  });

  it('nodeIds with no known matches: viewportApplied=false (default zoom)', async () => {
    const { navigator, panCalls } = fakeNavigator({ panOk: true });
    const vault = new InMemoryVaultAdapter();
    await vault.write('canvases/x.canvas', sampleCanvas);
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', nodeIds: ['ghost'] },
      makeToolCtx({ vault, canvasNavigator: navigator }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.viewportApplied).toBe(false);
    expect(panCalls).toHaveLength(0);
  });

  it('returns error when canvas navigator is missing', async () => {
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas' },
      makeToolCtx({ vault: new InMemoryVaultAdapter() }),
    );
    expect(result.ok).toBe(false);
  });

  it('returns error when path fails validation', async () => {
    const { navigator } = fakeNavigator();
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: '../escape.canvas' },
      makeToolCtx({ vault: new InMemoryVaultAdapter(), canvasNavigator: navigator }),
    );
    expect(result.ok).toBe(false);
  });

  it('returns error when openCanvas fails', async () => {
    const { navigator } = fakeNavigator({ openErr: 'canvas not found: x.canvas' });
    const tool = createRevealInCanvasTool();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas' },
      makeToolCtx({ vault: new InMemoryVaultAdapter(), canvasNavigator: navigator }),
    );
    expect(result.ok).toBe(false);
  });
});
