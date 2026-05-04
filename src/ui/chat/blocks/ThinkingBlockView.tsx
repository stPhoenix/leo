import { useState } from 'react';
import type { ThinkingBlock, RedactedThinkingBlock } from '@/chat/types';

export interface ThinkingBlockViewProps {
  readonly block: ThinkingBlock | RedactedThinkingBlock;
  readonly streaming: boolean;
}

export function ThinkingBlockView(props: ThinkingBlockViewProps): JSX.Element {
  const { block } = props;
  const [userExpanded, setUserExpanded] = useState<boolean>(false);
  if (block.type === 'redacted_thinking') {
    const bytes = block.data.length;
    return (
      <section
        className="leo-thinking-block leo-thinking-redacted"
        aria-label="thinking"
        data-slot="thinking-redacted"
      >
        <header className="leo-thinking-header" data-slot="thinking-header">
          Redacted thinking · ({bytes} bytes)
        </header>
      </section>
    );
  }
  const length = block.thinking.length;
  const expanded = props.streaming || userExpanded;
  const toggleable = !props.streaming;
  return (
    <section
      className={`leo-thinking-block${expanded ? ' is-expanded' : ' is-collapsed'}`}
      aria-label="thinking"
      data-slot="thinking"
      data-expanded={expanded ? 'true' : 'false'}
    >
      <header className="leo-thinking-header" data-slot="thinking-header">
        <span data-slot="thinking-label">Thinking</span>
        {!props.streaming ? <span data-slot="thinking-length"> · {length} chars</span> : null}
        {toggleable ? (
          <button
            type="button"
            className="leo-thinking-toggle"
            data-slot="thinking-toggle"
            aria-expanded={expanded}
            onClick={() => setUserExpanded((v) => !v)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : null}
      </header>
      <div className="leo-thinking-body-wrap">
        <div className="leo-thinking-body" data-slot="thinking-body" aria-hidden={!expanded}>
          {block.thinking}
        </div>
      </div>
    </section>
  );
}
