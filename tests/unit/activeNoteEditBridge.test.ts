import { describe, expect, it } from 'vitest';
import {
  createActiveNoteEditBridge,
  type ActiveMarkdownResolver,
  type EditorLike,
} from '@/editor/activeNoteEditBridge';
import { EditLockController } from '@/editor/editLock';
import { HighlightController } from '@/editor/highlights';

function makeFakeEditor(lines: string[]): EditorLike & {
  __value: string;
  __ops: Array<{ from: number; to: number; text: string; origin?: string }>;
} {
  const value = lines.join('\n');
  const lineOffsets = [0];
  for (const line of lines) {
    lineOffsets.push(lineOffsets[lineOffsets.length - 1]! + line.length + 1);
  }
  const state: {
    value: string;
    ops: Array<{ from: number; to: number; text: string; origin?: string }>;
  } = { value, ops: [] };
  return {
    get __value() {
      return state.value;
    },
    get __ops() {
      return state.ops;
    },
    getValue: () => state.value,
    setValue: (v: string) => {
      state.value = v;
    },
    posToOffset: ({ line, ch }) => {
      const base = lineOffsets[Math.min(line, lineOffsets.length - 1)] ?? state.value.length;
      return base + ch;
    },
    offsetToPos: (offset) => {
      let line = 0;
      while (line + 1 < lineOffsets.length && lineOffsets[line + 1]! <= offset) line += 1;
      return { line, ch: offset - (lineOffsets[line] ?? 0) };
    },
    replaceRange: (replacement, from, to, origin) => {
      const fromOff = (lineOffsets[from.line] ?? 0) + from.ch;
      const toOff = to === undefined ? fromOff : (lineOffsets[to.line] ?? 0) + to.ch;
      state.value = state.value.slice(0, fromOff) + replacement + state.value.slice(toOff);
      state.ops.push({
        from: fromOff,
        to: toOff,
        text: replacement,
        ...(origin !== undefined ? { origin } : {}),
      });
    },
  };
}

describe('createActiveNoteEditBridge', () => {
  it('isActiveNote is true only when resolver returns an editor', () => {
    const editor = makeFakeEditor(['# title', 'body']);
    const resolver: ActiveMarkdownResolver = {
      resolve: (p) => (p === 'note.md' ? editor : null),
    };
    const bridge = createActiveNoteEditBridge({
      resolver,
      lock: new EditLockController(),
      highlights: new HighlightController(),
    });
    expect(bridge.isActiveNote('note.md')).toBe(true);
    expect(bridge.isActiveNote('other.md')).toBe(false);
  });

  it('applyActiveEdit returns not-active when no editor resolves', async () => {
    const resolver: ActiveMarkdownResolver = { resolve: () => null };
    const bridge = createActiveNoteEditBridge({
      resolver,
      lock: new EditLockController(),
      highlights: new HighlightController(),
    });
    const r = await bridge.applyActiveEdit({
      path: 'note.md',
      lineStart: 0,
      lineEnd: 0,
      newContent: 'foo',
      signal: new AbortController().signal,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('not-active');
  });

  it('applyActiveEdit writes the range under the lock and releases', async () => {
    const editor = makeFakeEditor(['line-a', 'line-b', 'line-c']);
    const resolver: ActiveMarkdownResolver = { resolve: () => editor };
    const lock = new EditLockController();
    const highlights = new HighlightController({ setTimeoutImpl: setTimeout });
    const bridge = createActiveNoteEditBridge({ resolver, lock, highlights });

    const result = await bridge.applyActiveEdit({
      path: 'note.md',
      lineStart: 1,
      lineEnd: 1,
      newContent: 'NEW',
      signal: new AbortController().signal,
    });

    expect(result.ok).toBe(true);
    expect(editor.__value).toBe('line-a\nNEW\nline-c');
    expect(editor.__ops.length).toBe(1);
    expect(lock.isHeld()).toBe(false);
    expect(highlights.list().length).toBe(1);
  });

  it('returns ok=false and releases the lock when the signal aborts before apply', async () => {
    const editor = makeFakeEditor(['a', 'b']);
    const resolver: ActiveMarkdownResolver = { resolve: () => editor };
    const lock = new EditLockController();
    const highlights = new HighlightController();
    const bridge = createActiveNoteEditBridge({ resolver, lock, highlights });
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await bridge.applyActiveEdit({
      path: 'note.md',
      lineStart: 0,
      lineEnd: 0,
      newContent: 'x',
      signal: ctrl.signal,
    });
    expect(result.ok).toBe(false);
    expect(lock.isHeld()).toBe(false);
  });

  it('undo function reverts the edit to previous text', async () => {
    const editor = makeFakeEditor(['keep', 'target', 'keep']);
    const resolver: ActiveMarkdownResolver = { resolve: () => editor };
    const bridge = createActiveNoteEditBridge({
      resolver,
      lock: new EditLockController(),
      highlights: new HighlightController(),
    });
    const result = await bridge.applyActiveEdit({
      path: 'note.md',
      lineStart: 1,
      lineEnd: 1,
      newContent: 'CHANGED',
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.undo();
    expect(editor.__value).toBe('keep\ntarget\nkeep');
  });
});
