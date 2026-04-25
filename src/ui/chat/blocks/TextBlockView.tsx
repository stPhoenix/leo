import { useEffect, useRef } from 'react';
import type { TextBlock } from '@/chat/types';
import type { MarkdownRenderFn } from '../MessageList';
import { enhanceCodeBlocks, type CodeBlockClipboard } from '../codeBlockEnhancer';

export interface TextBlockViewProps {
  readonly block: TextBlock;
  readonly blockId: string;
  readonly showCursor: boolean;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function TextBlockView(props: TextBlockViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    host.replaceChildren();
    const cleanupMarkdown = props.renderMarkdown(props.block.text, host);
    const cleanupCodeButtons = enhanceCodeBlocks(host, {
      clipboard: props.clipboard,
      ...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {}),
    });
    return () => {
      cleanupCodeButtons();
      if (typeof cleanupMarkdown === 'function') cleanupMarkdown();
      host.replaceChildren();
    };
  }, [props.blockId, props.block.text, props.renderMarkdown, props.clipboard, props.setIcon]);

  return (
    <>
      <div className="leo-bubble-body" data-slot="assistant-markdown" ref={hostRef} />
      {props.showCursor ? (
        <span className="leo-streaming-cursor" data-slot="streaming-cursor" aria-hidden="true" />
      ) : null}
    </>
  );
}
