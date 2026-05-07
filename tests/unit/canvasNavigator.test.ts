import { describe, expect, it, vi, type Mock } from 'vitest';
import { TFile } from 'obsidian';
import {
  CANVAS_VIEW_TYPE,
  createObsidianCanvasNavigator,
  type CanvasNavigator,
} from '@/editor/canvasNavigator';

interface FakeLeaf {
  view: { file: { path: string } | null; canvas?: FakeCanvasInstance | undefined };
  openFile: Mock;
}

interface FakeCanvasInstance {
  zoomToBbox: Mock;
  requestFrame: Mock;
}

interface FakeApp {
  workspace: {
    getLeavesOfType: Mock;
    setActiveLeaf: Mock;
    revealLeaf: Mock;
    getLeaf: Mock;
  };
  vault: {
    getAbstractFileByPath: Mock;
  };
}

function makeNavigator(opts: {
  files: Record<string, true>;
  openLeaves?: { path: string; canvas?: FakeCanvasInstance | undefined }[];
}): {
  navigator: CanvasNavigator;
  app: FakeApp;
  newLeaf: FakeLeaf;
} {
  const leaves: FakeLeaf[] = (opts.openLeaves ?? []).map(({ path, canvas }) => {
    return {
      view: { file: { path }, canvas },
      openFile: vi.fn(() => Promise.resolve()),
    };
  });
  const newLeaf: FakeLeaf = {
    view: { file: null },
    openFile: vi.fn((file: TFile) => {
      newLeaf.view = { file: { path: file.path } };
      return Promise.resolve();
    }),
  };
  const app: FakeApp = {
    workspace: {
      getLeavesOfType: vi.fn((type: string) => (type === CANVAS_VIEW_TYPE ? leaves : [])),
      setActiveLeaf: vi.fn(() => undefined),
      revealLeaf: vi.fn(() => undefined),
      getLeaf: vi.fn(() => newLeaf),
    },
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => {
        if (!(path in opts.files)) return null;
        const f = new TFile();
        f.path = path;
        return f;
      }),
    },
  };
  const navigator = createObsidianCanvasNavigator({
    app: app as unknown as Parameters<typeof createObsidianCanvasNavigator>[0]['app'],
  });
  return { navigator, app, newLeaf };
}

function fakeCanvas(): FakeCanvasInstance {
  return {
    zoomToBbox: vi.fn(() => undefined),
    requestFrame: vi.fn(() => undefined),
  };
}

describe('canvasNavigator.openCanvas', () => {
  it('opens a new leaf when no leaf has the canvas', async () => {
    const t = makeNavigator({ files: { 'a/b.canvas': true } });
    const result = await t.navigator.openCanvas('a/b.canvas');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(t.newLeaf.openFile).toHaveBeenCalledTimes(1);
    expect(t.app.workspace.getLeaf).toHaveBeenCalledWith(false);
  });

  it('reveals the existing leaf when one already shows the canvas', async () => {
    const t = makeNavigator({
      files: { 'a/b.canvas': true },
      openLeaves: [{ path: 'a/b.canvas', canvas: fakeCanvas() }],
    });
    const result = await t.navigator.openCanvas('a/b.canvas');
    expect(result.ok).toBe(true);
    expect(t.newLeaf.openFile).not.toHaveBeenCalled();
    expect(t.app.workspace.setActiveLeaf).toHaveBeenCalledTimes(1);
    expect(t.app.workspace.revealLeaf).toHaveBeenCalledTimes(1);
  });

  it('returns error when canvas file does not resolve to TFile', async () => {
    const t = makeNavigator({ files: {} });
    const result = await t.navigator.openCanvas('missing.canvas');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('canvas not found');
  });
});

describe('canvasNavigator.panZoomToBbox', () => {
  it('returns true and calls zoomToBbox with padded bbox when the internal API is present', async () => {
    const canvas = fakeCanvas();
    const t = makeNavigator({
      files: { 'a/b.canvas': true },
      openLeaves: [{ path: 'a/b.canvas', canvas }],
    });
    const opened = await t.navigator.openCanvas('a/b.canvas');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ok = t.navigator.panZoomToBbox(opened.leaf, { x: 100, y: 200, w: 50, h: 30 }, 80);
    expect(ok).toBe(true);
    expect(canvas.zoomToBbox).toHaveBeenCalledWith({
      minX: 100 - 80,
      minY: 200 - 80,
      maxX: 100 + 50 + 80,
      maxY: 200 + 30 + 80,
    });
    expect(canvas.requestFrame).toHaveBeenCalledTimes(1);
  });

  it('returns false (does not throw) when leaf view lacks canvas instance', async () => {
    const t = makeNavigator({
      files: { 'a/b.canvas': true },
      openLeaves: [{ path: 'a/b.canvas' }],
    });
    const opened = await t.navigator.openCanvas('a/b.canvas');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ok = t.navigator.panZoomToBbox(opened.leaf, { x: 0, y: 0, w: 1, h: 1 }, 80);
    expect(ok).toBe(false);
  });

  it('returns false when canvas instance is missing zoomToBbox', async () => {
    const partial = {
      zoomToBbox: undefined,
      requestFrame: vi.fn(),
    } as unknown as FakeCanvasInstance;
    const t = makeNavigator({
      files: { 'a/b.canvas': true },
      openLeaves: [{ path: 'a/b.canvas', canvas: partial }],
    });
    const opened = await t.navigator.openCanvas('a/b.canvas');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const ok = t.navigator.panZoomToBbox(opened.leaf, { x: 0, y: 0, w: 1, h: 1 }, 80);
    expect(ok).toBe(false);
  });

  it('feature-detection probe never throws on weird shapes', async () => {
    const weird = {} as unknown as FakeCanvasInstance;
    const t = makeNavigator({
      files: { 'a/b.canvas': true },
      openLeaves: [{ path: 'a/b.canvas', canvas: weird }],
    });
    const opened = await t.navigator.openCanvas('a/b.canvas');
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(() =>
      t.navigator.panZoomToBbox(opened.leaf, { x: 0, y: 0, w: 1, h: 1 }, 80),
    ).not.toThrow();
  });
});
