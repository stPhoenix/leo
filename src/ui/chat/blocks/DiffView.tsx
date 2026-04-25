import { memo, useMemo, useState } from 'react';
import { computeUnifiedDiff } from '@/chat/diff';

export interface DiffViewProps {
  readonly before: string;
  readonly after: string;
  readonly path?: string;
  readonly defaultCollapseAtChanges?: number;
}

const COLLAPSE_AT = 30;

function DiffViewImpl(props: DiffViewProps): JSX.Element {
  const { lines, stats } = useMemo(
    () => computeUnifiedDiff(props.before, props.after),
    [props.before, props.after],
  );
  const totalChanges = stats.added + stats.removed;
  const threshold = props.defaultCollapseAtChanges ?? COLLAPSE_AT;
  const [expanded, setExpanded] = useState<boolean>(totalChanges < threshold);
  const isIdentical = totalChanges === 0 && lines.length === 0;
  if (isIdentical) {
    return (
      <div className="leo-diff leo-diff-identical" data-slot="diff" data-status="identical">
        result · no changes
      </div>
    );
  }
  return (
    <div
      className={`leo-diff${expanded ? ' is-expanded' : ' is-collapsed'}`}
      data-slot="diff"
      data-added={stats.added}
      data-removed={stats.removed}
    >
      <header className="leo-diff-header" data-slot="diff-header">
        <span data-slot="diff-summary">
          result · {stats.added} +, {stats.removed} −
          {props.path !== undefined ? ` (${props.path})` : ''}
        </span>
        {totalChanges >= threshold || !expanded ? (
          <button
            type="button"
            className="leo-diff-toggle"
            data-slot="diff-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▾ collapse' : `▸ Show diff (${stats.added} +, ${stats.removed} −)`}
          </button>
        ) : null}
      </header>
      {expanded ? (
        <pre className="leo-diff-body" data-slot="diff-body">
          {lines.map((l, i) => (
            <div key={i} className={`leo-diff-line leo-diff-${l.kind}`} data-kind={l.kind}>
              <span className="leo-diff-gutter-before" data-slot="diff-gutter-before">
                {l.beforeLine ?? ''}
              </span>
              <span className="leo-diff-gutter-after" data-slot="diff-gutter-after">
                {l.afterLine ?? ''}
              </span>
              <span className="leo-diff-marker" data-slot="diff-marker">
                {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}
              </span>
              <span className="leo-diff-text" data-slot="diff-text">
                {l.text}
              </span>
            </div>
          ))}
        </pre>
      ) : null}
    </div>
  );
}

export const DiffView = memo(DiffViewImpl);
