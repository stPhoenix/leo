import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import type { EditLockController, LockedRange } from './editLock';
import type { HighlightController, HighlightRange } from './highlights';

export interface CreateLockDecorationOptions {
  readonly lock: EditLockController;
  readonly highlights: HighlightController;
}

export function createLockDecorationExtension(opts: CreateLockDecorationOptions): Extension {
  const lockMark = Decoration.mark({
    class: 'leo-edit-lock-range',
    inclusive: true,
    attributes: { 'data-leo-lock': 'true' },
  });
  const highlightMark = Decoration.mark({
    class: 'leo-edit-highlight-range',
    inclusive: true,
    attributes: { 'data-leo-highlight': 'true' },
  });

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private unsubLock: (() => void) | null = null;
      private unsubHighlights: (() => void) | null = null;
      private lockRange: LockedRange | null;
      private highlightRanges: readonly HighlightRange[];

      constructor(readonly view: EditorView) {
        this.lockRange = opts.lock.current();
        this.highlightRanges = opts.highlights.list();
        this.rebuild();
        this.unsubLock = opts.lock.subscribe((range) => {
          this.lockRange = range;
          this.scheduleRebuild();
        });
        this.unsubHighlights = opts.highlights.subscribe((ranges) => {
          this.highlightRanges = ranges;
          this.scheduleRebuild();
        });
      }

      update(_u: ViewUpdate): void {
        /* decorations rebuilt by subscription; no per-update work */
      }

      destroy(): void {
        this.unsubLock?.();
        this.unsubLock = null;
        this.unsubHighlights?.();
        this.unsubHighlights = null;
      }

      private scheduleRebuild(): void {
        this.rebuild();
        this.view.dispatch({
          effects: [],
        });
      }

      private rebuild(): void {
        const builder = new RangeSetBuilder<Decoration>();
        const contentLength = this.view.state.doc.length;
        const lock = this.lockRange;
        if (lock !== null && lock.from < lock.to && lock.to <= contentLength) {
          builder.add(lock.from, lock.to, lockMark);
        }
        for (const h of this.highlightRanges) {
          if (h.from < h.to && h.to <= contentLength) {
            builder.add(h.from, h.to, highlightMark);
          }
        }
        this.decorations = builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        beforeinput: (event, view): boolean => {
          const lock = opts.lock.current();
          if (lock === null) return false;
          const fromSel = Math.min(
            ...view.state.selection.ranges.map((r) => Math.min(r.from, r.to)),
          );
          const toSel = Math.max(...view.state.selection.ranges.map((r) => Math.max(r.from, r.to)));
          if (fromSel < lock.to && toSel > lock.from) {
            opts.lock.recordBlocked(fromSel, toSel);
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
    },
  );
}
