import { MarkdownView, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { Logger } from '@/platform/Logger';
import type { HighlightController } from './highlights';

export interface WorkspaceNavigator {
  openNote(
    path: string,
  ): Promise<{ ok: true; status: 'opened' | 'revealed' } | { ok: false; error: string }>;
  revealInNote(
    input: RevealInput,
  ): Promise<
    { ok: true; status: 'revealed'; from: number; to: number } | { ok: false; error: string }
  >;
}

export interface RevealInput {
  readonly path: string;
  readonly lineStart: number;
  readonly lineEnd?: number;
  readonly chStart?: number;
  readonly chEnd?: number;
}

export interface WorkspaceNavigatorOptions {
  readonly app: App;
  readonly highlights: HighlightController;
  readonly logger?: Logger;
}

interface ObsidianEditor {
  posToOffset(pos: { line: number; ch: number }): number;
  setSelection(anchor: { line: number; ch: number }, head?: { line: number; ch: number }): void;
  scrollIntoView(
    range: { from: { line: number; ch: number }; to: { line: number; ch: number } },
    center?: boolean,
  ): void;
  lineCount(): number;
  getLine(n: number): string;
}

export function createObsidianWorkspaceNavigator(
  opts: WorkspaceNavigatorOptions,
): WorkspaceNavigator {
  const { app, highlights, logger } = opts;

  const findLeafForPath = (path: string): WorkspaceLeaf | null => {
    const leaves = app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) return leaf;
    }
    return null;
  };

  const ensureOpen = async (
    path: string,
  ): Promise<
    { ok: true; status: 'opened' | 'revealed'; leaf: WorkspaceLeaf } | { ok: false; error: string }
  > => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { ok: false, error: `note not found: ${path}` };
    }
    const existing = findLeafForPath(path);
    if (existing !== null) {
      app.workspace.setActiveLeaf(existing, { focus: true });
      app.workspace.revealLeaf(existing);
      logger?.debug('navigator.openNote.revealed', { path });
      return { ok: true, status: 'revealed', leaf: existing };
    }
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    logger?.debug('navigator.openNote.opened', { path });
    return { ok: true, status: 'opened', leaf };
  };

  return {
    async openNote(path) {
      try {
        const opened = await ensureOpen(path);
        if (!opened.ok) return opened;
        return { ok: true, status: opened.status };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn('navigator.openNote.error', { path, error: message });
        return { ok: false, error: message };
      }
    },

    async revealInNote(input) {
      try {
        const opened = await ensureOpen(input.path);
        if (!opened.ok) return opened;

        const view = opened.leaf.view;
        if (!(view instanceof MarkdownView)) {
          return { ok: false, error: 'failed to focus note' };
        }
        const editor = view.editor as unknown as ObsidianEditor;
        const lineCount = editor.lineCount();
        if (input.lineStart < 0 || input.lineStart >= lineCount) {
          return { ok: false, error: `line out of range: ${input.lineStart}` };
        }
        if (input.lineEnd !== undefined && input.lineEnd >= lineCount) {
          return { ok: false, error: `line out of range: ${input.lineEnd}` };
        }

        const lineStart = input.lineStart;
        const lineEnd = input.lineEnd ?? input.lineStart;
        const chStart = input.chStart ?? 0;
        const chEnd =
          input.chEnd ?? (input.lineEnd !== undefined ? editor.getLine(lineEnd).length : chStart);

        const fromPos = { line: lineStart, ch: clampCh(chStart, editor.getLine(lineStart)) };
        const toPos =
          input.lineEnd === undefined && input.chEnd === undefined
            ? fromPos
            : { line: lineEnd, ch: clampCh(chEnd, editor.getLine(lineEnd)) };

        editor.setSelection(fromPos, toPos);
        editor.scrollIntoView({ from: fromPos, to: toPos }, true);

        const from = editor.posToOffset(fromPos);
        const to = editor.posToOffset(toPos);
        if (to > from) highlights.highlight(from, to);
        logger?.debug('navigator.revealInNote', { path: input.path, from, to });
        return { ok: true, status: 'revealed', from, to };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn('navigator.revealInNote.error', { path: input.path, error: message });
        return { ok: false, error: message };
      }
    },
  };
}

function clampCh(ch: number, line: string): number {
  if (ch < 0) return 0;
  if (ch > line.length) return line.length;
  return ch;
}
