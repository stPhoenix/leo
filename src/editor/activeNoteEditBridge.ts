import type { Logger } from '@/platform/Logger';
import type { EditNoteBridge } from '@/tools/types';
import { withLock, type ApplyEdit } from './withLock';
import type { EditLockController, LockedRange } from './editLock';
import type { HighlightController } from './highlights';

export interface EditorLike {
  getValue(): string;
  setValue(value: string): void;
  posToOffset(pos: { line: number; ch: number }): number;
  offsetToPos(offset: number): { line: number; ch: number };
  replaceRange(
    replacement: string,
    from: { line: number; ch: number },
    to?: { line: number; ch: number },
    origin?: string,
  ): void;
  transaction?(
    tx: {
      readonly changes?: ReadonlyArray<{
        readonly from: { line: number; ch: number };
        readonly to?: { line: number; ch: number };
        readonly text: string;
      }>;
    },
    origin?: string,
  ): void;
}

export interface ActiveMarkdownResolver {
  /**
   * Return the editor for `path` iff that file is currently open and focused, else null.
   */
  resolve(path: string): EditorLike | null;
}

export interface ActiveNoteEditBridgeOptions {
  readonly resolver: ActiveMarkdownResolver;
  readonly lock: EditLockController;
  readonly highlights: HighlightController;
  readonly logger?: Logger;
  readonly origin?: string;
}

function rangeFromLines(editor: EditorLike, lineStart: number, lineEnd: number): LockedRange {
  const from = editor.posToOffset({ line: lineStart, ch: 0 });
  const lastLineEndOffset = editor.posToOffset({
    line: lineEnd + 1,
    ch: 0,
  });
  return { from, to: lastLineEndOffset };
}

export function createActiveNoteEditBridge(opts: ActiveNoteEditBridgeOptions): EditNoteBridge {
  const origin = opts.origin ?? 'leo-edit';

  return {
    isActiveNote(path: string): boolean {
      return opts.resolver.resolve(path) !== null;
    },
    async applyActiveEdit(input) {
      const editor = opts.resolver.resolve(input.path);
      if (editor === null) return { ok: false, error: 'not-active' };
      const range = rangeFromLines(editor, input.lineStart, input.lineEnd);
      let bytesWritten = 0;
      let previousText = '';
      const apply: ApplyEdit = async ({ signal }) => {
        if (signal.aborted) return { ok: false };
        const full = editor.getValue();
        previousText = full.slice(range.from, range.to);
        const nextText = input.newContent.endsWith('\n')
          ? input.newContent
          : `${input.newContent}\n`;
        bytesWritten = new TextEncoder().encode(nextText).length;
        const fromPos = editor.offsetToPos(range.from);
        const toPos = editor.offsetToPos(range.to);
        if (typeof editor.transaction === 'function') {
          editor.transaction(
            {
              changes: [{ from: fromPos, to: toPos, text: nextText }],
            },
            origin,
          );
        } else {
          editor.replaceRange(nextText, fromPos, toPos, origin);
        }
        const newEnd = range.from + nextText.length;
        return { ok: true, newRange: { from: range.from, to: newEnd } };
      };
      const result = await withLock(
        {
          lock: opts.lock,
          highlights: opts.highlights,
          ...(opts.logger ? { logger: opts.logger } : {}),
        },
        range,
        input.signal,
        apply,
      );
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      const undoFn = (): void => {
        const fromPos = editor.offsetToPos(result.range.from);
        const toPos = editor.offsetToPos(result.range.to);
        editor.replaceRange(previousText, fromPos, toPos, `${origin}-undo`);
      };
      return { ok: true, bytesWritten, undo: undoFn };
    },
  };
}
