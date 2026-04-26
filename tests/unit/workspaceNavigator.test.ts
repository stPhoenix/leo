import { describe, expect, it, vi, type Mock } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import {
  createObsidianWorkspaceNavigator,
  type WorkspaceNavigator,
} from '@/editor/workspaceNavigator';
import { HighlightController } from '@/editor/highlights';

interface FakeEditor {
  lines: string[];
  setSelection: Mock;
  scrollIntoView: Mock;
  posToOffset(pos: { line: number; ch: number }): number;
  offsetToPos(off: number): { line: number; ch: number };
  lineCount(): number;
  getLine(n: number): string;
}

function fakeEditor(lines: string[]): FakeEditor {
  return {
    lines,
    setSelection: vi.fn(() => undefined),
    scrollIntoView: vi.fn(() => undefined),
    posToOffset: ({ line, ch }) => {
      let off = 0;
      for (let i = 0; i < line; i++) off += lines[i]!.length + 1;
      return off + ch;
    },
    offsetToPos: (off) => {
      let line = 0;
      let remaining = off;
      while (line < lines.length && remaining > lines[line]!.length) {
        remaining -= lines[line]!.length + 1;
        line += 1;
      }
      return { line, ch: remaining };
    },
    lineCount: () => lines.length,
    getLine: (n) => lines[n] ?? '',
  };
}

interface FakeLeaf {
  view: { file: { path: string } | null };
  openFile: Mock;
}

interface FakeApp {
  workspace: {
    getLeavesOfType: Mock;
    setActiveLeaf: Mock;
    revealLeaf: Mock;
    getLeaf: Mock;
    getActiveViewOfType: Mock;
  };
  vault: {
    getAbstractFileByPath: Mock;
  };
}

function makeNavigator(opts: {
  files: Record<string, FakeEditor | null>;
  openLeaves?: { path: string }[];
}): {
  navigator: WorkspaceNavigator;
  app: FakeApp;
  highlights: HighlightController;
  highlightSpy: Mock;
  newLeaf: FakeLeaf;
  reveals: { path: string }[];
} {
  const reveals: { path: string }[] = [];
  const leaves: FakeLeaf[] = (opts.openLeaves ?? []).map(({ path }) => {
    const editor = opts.files[path] ?? null;
    const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
      file: { path },
      ...(editor !== null ? { editor } : {}),
    });
    return {
      view: view as unknown as { file: { path: string } | null },
      openFile: vi.fn(() => Promise.resolve()),
    };
  });
  const newLeaf: FakeLeaf = {
    view: { file: null },
    openFile: vi.fn((file: TFile) => {
      const editor = opts.files[file.path] ?? null;
      newLeaf.view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
        file: { path: file.path },
        ...(editor !== null ? { editor } : {}),
      }) as unknown as { file: { path: string } | null };
      return Promise.resolve();
    }),
  };

  const app: FakeApp = {
    workspace: {
      getLeavesOfType: vi.fn(() => leaves),
      setActiveLeaf: vi.fn((leaf: FakeLeaf) => {
        const path = leaf.view.file?.path;
        if (path !== undefined) reveals.push({ path });
      }),
      revealLeaf: vi.fn(() => undefined),
      getLeaf: vi.fn(() => newLeaf),
      getActiveViewOfType: vi.fn(() => null),
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
  const highlights = new HighlightController();
  const highlightSpy = vi.fn((_from: number, _to: number) => 0);
  (highlights as unknown as { highlight: Mock }).highlight = highlightSpy;
  const navigator = createObsidianWorkspaceNavigator({
    app: app as unknown as Parameters<typeof createObsidianWorkspaceNavigator>[0]['app'],
    highlights,
  });
  return { navigator, app, highlights, highlightSpy, newLeaf, reveals };
}

describe('workspaceNavigator.openNote', () => {
  it('returns "opened" when no leaf has the file and openFile is called on a new leaf', async () => {
    const t = makeNavigator({ files: { 'a.md': fakeEditor(['x']) } });
    const result = await t.navigator.openNote('a.md');
    expect(result).toEqual({ ok: true, status: 'opened' });
    expect(t.newLeaf.openFile).toHaveBeenCalledTimes(1);
    expect(t.app.workspace.getLeaf).toHaveBeenCalledWith(false);
  });

  it('returns "revealed" when a leaf already has the file', async () => {
    const t = makeNavigator({
      files: { 'a.md': fakeEditor(['x']) },
      openLeaves: [{ path: 'a.md' }],
    });
    const result = await t.navigator.openNote('a.md');
    expect(result).toEqual({ ok: true, status: 'revealed' });
    expect(t.newLeaf.openFile).not.toHaveBeenCalled();
    expect(t.app.workspace.setActiveLeaf).toHaveBeenCalledTimes(1);
    expect(t.app.workspace.revealLeaf).toHaveBeenCalledTimes(1);
  });

  it('returns error when path does not resolve to TFile', async () => {
    const t = makeNavigator({ files: {} });
    const result = await t.navigator.openNote('missing.md');
    expect(result).toEqual({ ok: false, error: 'note not found: missing.md' });
  });
});

describe('workspaceNavigator.revealInNote', () => {
  it('places cursor when only lineStart given (from === to)', async () => {
    const editor = fakeEditor(['hello', 'world']);
    const t = makeNavigator({ files: { 'a.md': editor }, openLeaves: [{ path: 'a.md' }] });

    const result = await t.navigator.revealInNote({ path: 'a.md', lineStart: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.from).toBe(result.to);
    expect(editor.setSelection).toHaveBeenCalledWith({ line: 1, ch: 0 }, { line: 1, ch: 0 });
    expect(editor.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(t.highlightSpy).not.toHaveBeenCalled();
  });

  it('selects whole-line range when lineEnd given without chars and triggers highlight', async () => {
    const editor = fakeEditor(['abc', 'defg', 'hi']);
    const t = makeNavigator({ files: { 'a.md': editor }, openLeaves: [{ path: 'a.md' }] });

    const result = await t.navigator.revealInNote({ path: 'a.md', lineStart: 0, lineEnd: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 0 }, { line: 1, ch: 4 });
    expect(t.highlightSpy).toHaveBeenCalledTimes(1);
    expect(result.to).toBeGreaterThan(result.from);
  });

  it('uses chStart/chEnd when provided', async () => {
    const editor = fakeEditor(['abcdef', 'ghijkl']);
    const t = makeNavigator({ files: { 'a.md': editor }, openLeaves: [{ path: 'a.md' }] });

    const result = await t.navigator.revealInNote({
      path: 'a.md',
      lineStart: 0,
      lineEnd: 1,
      chStart: 2,
      chEnd: 5,
    });
    expect(result.ok).toBe(true);
    expect(editor.setSelection).toHaveBeenCalledWith({ line: 0, ch: 2 }, { line: 1, ch: 5 });
  });

  it('returns line-out-of-range error when lineStart >= lineCount', async () => {
    const editor = fakeEditor(['only']);
    const t = makeNavigator({ files: { 'a.md': editor }, openLeaves: [{ path: 'a.md' }] });

    const result = await t.navigator.revealInNote({ path: 'a.md', lineStart: 99 });
    expect(result).toEqual({ ok: false, error: 'line out of range: 99' });
    expect(editor.setSelection).not.toHaveBeenCalled();
  });

  it('returns error when path does not resolve to TFile', async () => {
    const t = makeNavigator({ files: {} });
    const result = await t.navigator.revealInNote({ path: 'missing.md', lineStart: 0 });
    expect(result).toEqual({ ok: false, error: 'note not found: missing.md' });
  });
});
