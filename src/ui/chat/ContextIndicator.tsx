import { useSyncExternalStore } from 'react';
import { NULL_FOCUSED_CONTEXT, type FocusedContext } from '@/editor/types';

export interface ContextIndicatorSource {
  readonly getContext: () => FocusedContext;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface ContextIndicatorProps {
  readonly collapsed: boolean;
  readonly source?: ContextIndicatorSource;
  readonly onReveal?: (file: string) => void;
}

const STATIC_NULL_SOURCE: ContextIndicatorSource = {
  getContext: () => NULL_FOCUSED_CONTEXT,
  subscribe: () => () => undefined,
};

export function ContextIndicator(props: ContextIndicatorProps): JSX.Element | null {
  const source = props.source ?? STATIC_NULL_SOURCE;
  const ctx = useSyncExternalStore<FocusedContext>(
    source.subscribe,
    source.getContext,
    source.getContext,
  );

  const hasFile = ctx.file !== null;

  if (props.collapsed) {
    return (
      <section
        className="leo-context-indicator is-collapsed"
        aria-label="context"
        data-region="context"
      >
        <span className="leo-context-summary" data-slot="context-summary">
          {hasFile ? basename(ctx.file!) : 'context unavailable'}
        </span>
      </section>
    );
  }

  if (!hasFile) {
    return (
      <section
        className="leo-context-indicator is-empty"
        aria-label="context"
        data-region="context"
        data-empty="true"
        hidden
      />
    );
  }

  const file = ctx.file!;
  const name = basename(file);
  const viewportLabel =
    ctx.viewport !== null ? `${ctx.viewport.from + 1}–${ctx.viewport.to + 1}` : '--';
  const selectionLabel =
    ctx.selection !== null ? `${ctx.selection.from.line + 1}–${ctx.selection.to.line + 1}` : null;
  const reveal = props.onReveal;

  return (
    <section className="leo-context-indicator" aria-label="context" data-region="context">
      <button
        type="button"
        className="leo-context-chip"
        data-slot="context-chip"
        title={file}
        onClick={reveal !== undefined ? () => reveal(file) : undefined}
      >
        <span className="leo-context-chip-note" data-slot="context-note">
          {name}
        </span>
        <span className="leo-context-chip-range" data-slot="context-range">
          {viewportLabel}
        </span>
        {selectionLabel !== null ? (
          <span className="leo-context-chip-sel" data-slot="context-selection">
            sel {selectionLabel}
          </span>
        ) : null}
      </button>
    </section>
  );
}

function basename(file: string): string {
  const slash = file.lastIndexOf('/');
  const tail = slash >= 0 ? file.slice(slash + 1) : file;
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(0, dot) : tail;
}
