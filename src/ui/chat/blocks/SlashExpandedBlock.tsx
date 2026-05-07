import { useEffect, useRef, useState } from 'react';
import type { SlashExpandedBlock } from '@/chat/types';
import type { MarkdownRenderFn } from '../MessageList';
import { enhanceCodeBlocks, type CodeBlockClipboard } from '../codeBlockEnhancer';

export interface SlashExpandedBlockViewProps {
  readonly block: SlashExpandedBlock;
  readonly blockId: string;
  readonly renderMarkdown?: MarkdownRenderFn;
  readonly clipboard?: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function SlashExpandedBlockView(props: SlashExpandedBlockViewProps): JSX.Element {
  const { block } = props;
  const [expanded, setExpanded] = useState<boolean>(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const renderMarkdown = props.renderMarkdown;
    if (renderMarkdown === undefined) {
      host.replaceChildren();
      const pre = host.ownerDocument.createElement('pre');
      pre.className = 'leo-slash-expanded-pre';
      pre.textContent = block.expandedBody;
      host.appendChild(pre);
      return () => {
        host.replaceChildren();
      };
    }
    host.replaceChildren();
    const cleanupMarkdown = renderMarkdown(block.expandedBody, host);
    const cleanupCodeButtons =
      props.clipboard !== undefined
        ? enhanceCodeBlocks(host, {
            clipboard: props.clipboard,
            ...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {}),
          })
        : (): void => undefined;
    return () => {
      cleanupCodeButtons();
      if (typeof cleanupMarkdown === 'function') cleanupMarkdown();
      host.replaceChildren();
    };
  }, [props.blockId, block.expandedBody, props.renderMarkdown, props.clipboard, props.setIcon]);

  const length = block.expandedBody.length;
  const label = `Expanded prompt: /${block.command}`;

  return (
    <section
      className={`leo-slash-expanded${expanded ? ' is-expanded' : ' is-collapsed'}`}
      aria-label="expanded slash command prompt"
      data-slot="slash-expanded"
      data-expanded={expanded ? 'true' : 'false'}
      data-command={block.command}
    >
      <header className="leo-slash-expanded-header" data-slot="slash-expanded-header">
        <span data-slot="slash-expanded-label">{label}</span>
        <span data-slot="slash-expanded-length"> · {length} chars</span>
        <button
          type="button"
          className="leo-slash-expanded-toggle"
          data-slot="slash-expanded-toggle"
          aria-expanded={expanded}
          aria-controls={`slash-expanded-body-${props.blockId}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '▾ Hide prompt' : '▸ Show prompt'}
        </button>
      </header>
      <div className="leo-slash-expanded-body-wrap">
        <div
          id={`slash-expanded-body-${props.blockId}`}
          className="leo-slash-expanded-body"
          data-slot="slash-expanded-body"
          aria-hidden={!expanded}
          ref={hostRef}
        />
      </div>
    </section>
  );
}
