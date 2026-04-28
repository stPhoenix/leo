import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { MarkdownView } from 'obsidian';
import { focusSnapshotField } from '@/editor/focusedContext';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import { WorkspaceFocusProbe } from '@/editor/workspaceFocusProbe';

function makeView(text: string, anchor: number, head: number): EditorView {
  const state = EditorState.create({
    doc: text,
    extensions: [focusSnapshotField],
    selection: { anchor, head },
  });
  return { state, viewport: { from: 0, to: text.length } } as unknown as EditorView;
}

class FakeMarkdownView extends (MarkdownView as new () => object) {
  readonly editor: { cm: EditorView };
  readonly file: { path: string } | null;
  constructor(view: EditorView, path: string | null) {
    super();
    this.editor = { cm: view };
    this.file = path !== null ? { path } : null;
  }
}

interface FakeLeaf {
  view: unknown;
}

class FakeWorkspace {
  active: FakeMarkdownView | null = null;
  getActiveViewOfType<T>(_ctor: unknown): T | null {
    return this.active as unknown as T | null;
  }
}

function makeProbe(): { probe: WorkspaceFocusProbe; ws: FakeWorkspace } {
  const ws = new FakeWorkspace();
  const app = { workspace: ws } as unknown as ConstructorParameters<typeof WorkspaceFocusProbe>[0];
  return { probe: new WorkspaceFocusProbe(app), ws };
}

const NOTE_A = 'line one\nline two\nline three\n';
const NOTE_B = 'alpha\nbeta\ngamma\ndelta\n';

describe('WorkspaceFocusProbe', () => {
  it('observeView captures selection; read returns it while markdown is active', () => {
    const { probe, ws } = makeProbe();
    const viewA = makeView(NOTE_A, 0, 8);
    const mdA = new FakeMarkdownView(viewA, 'A.md');
    ws.active = mdA;

    probe.observeView(viewA);
    const ctx = probe.read();

    expect(ctx.file).toBe('A.md');
    expect(ctx.selection).toEqual({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 8 } });
  });

  it('keeps last selection when active leaf becomes a non-MarkdownView (chat panel)', () => {
    // Regression: clicking the chat composer used to wipe this.last and force NULL.
    const { probe, ws } = makeProbe();
    const viewA = makeView(NOTE_A, 0, 13);
    const mdA = new FakeMarkdownView(viewA, 'A.md');
    ws.active = mdA;

    probe.observeView(viewA);
    expect(probe.read().selection).not.toBeNull();

    class ChatItemView {}
    const chatLeaf: FakeLeaf = { view: new ChatItemView() };
    ws.active = null;
    probe.onLeafChange(chatLeaf as never);

    const ctx = probe.read();
    expect(ctx.file).toBe('A.md');
    expect(ctx.selection).toEqual({ from: { line: 0, ch: 0 }, to: { line: 1, ch: 4 } });
  });

  it('keeps last selection when leaf becomes null', () => {
    const { probe, ws } = makeProbe();
    const viewA = makeView(NOTE_A, 0, 5);
    const mdA = new FakeMarkdownView(viewA, 'A.md');
    ws.active = mdA;
    probe.observeView(viewA);

    ws.active = null;
    probe.onLeafChange(null);

    expect(probe.read().file).toBe('A.md');
    expect(probe.read().selection).toEqual({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } });
  });

  it('switches to the new markdown view when leaf changes to another note', () => {
    const { probe, ws } = makeProbe();
    const viewA = makeView(NOTE_A, 0, 5);
    const mdA = new FakeMarkdownView(viewA, 'A.md');
    ws.active = mdA;
    probe.observeView(viewA);

    const viewB = makeView(NOTE_B, 0, 5);
    const mdB = new FakeMarkdownView(viewB, 'B.md');
    ws.active = mdB;
    probe.onLeafChange({ view: mdB } as never);

    const ctx = probe.read();
    expect(ctx.file).toBe('B.md');
    expect(ctx.selection).toEqual({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } });
  });

  it('returns NULL_FOCUSED_CONTEXT when no active markdown and no cached view', () => {
    const { probe, ws } = makeProbe();
    ws.active = null;
    expect(probe.read()).toEqual(NULL_FOCUSED_CONTEXT);
  });

  it('prefers the live active view over the cached one when both exist', () => {
    const { probe, ws } = makeProbe();
    const viewA = makeView(NOTE_A, 0, 5);
    const mdA = new FakeMarkdownView(viewA, 'A.md');
    probe.observeView(viewA);

    const viewB = makeView(NOTE_B, 0, 4);
    const mdB = new FakeMarkdownView(viewB, 'B.md');
    ws.active = mdB;

    void mdA;
    const ctx = probe.read();
    expect(ctx.file).toBe('B.md');
    expect(ctx.selection).toEqual({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 4 } });
  });
});
