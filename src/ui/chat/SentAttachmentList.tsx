import { useEffect, useRef } from 'react';
import type { ContentBlock, ImageBlock, DocumentBlock } from '@/chat/types';

export interface SentAttachmentListProps {
  readonly blocks: readonly ContentBlock[];
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function SentAttachmentList(props: SentAttachmentListProps): JSX.Element | null {
  const items: ReadonlyArray<ImageBlock | DocumentBlock> = props.blocks.filter(
    (b): b is ImageBlock | DocumentBlock => b.type === 'image' || b.type === 'document',
  );
  if (items.length === 0) return null;
  return (
    <div
      className="leo-sent-attachments"
      role="list"
      aria-label="sent attachments"
      data-slot="sent-attachments"
    >
      {items.map((b, i) => (
        <SentAttachmentChip
          key={`${b.type}-${i}`}
          block={b}
          {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
        />
      ))}
    </div>
  );
}

function SentAttachmentChip(props: {
  readonly block: ImageBlock | DocumentBlock;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}): JSX.Element {
  const { block } = props;
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const isImage = block.type === 'image';
  const name = block.name ?? (isImage ? 'image' : 'document');
  const previewUrl = isImage ? `data:${block.source.media_type};base64,${block.source.data}` : null;

  useEffect(() => {
    const el = iconRef.current;
    if (el === null || previewUrl !== null) return;
    el.replaceChildren();
    const glyph = isImage ? 'image' : 'file-text';
    if (props.setIcon !== undefined) props.setIcon(el, glyph);
    else el.textContent = isImage ? '🖼' : '📄';
  }, [isImage, previewUrl, props.setIcon]);

  return (
    <span
      role="listitem"
      className={`leo-attachment-chip is-${block.type} is-sent`}
      data-slot="sent-attachment"
      data-kind={block.type}
      title={name}
    >
      {previewUrl !== null ? (
        <img className="leo-attachment-thumb" src={previewUrl} alt="" data-slot="sent-thumb" />
      ) : (
        <span ref={iconRef} className="leo-attachment-icon" data-slot="sent-icon" />
      )}
      <span className="leo-attachment-name" data-slot="sent-name">
        {name}
      </span>
      {block.size !== undefined ? (
        <span className="leo-attachment-size" data-slot="sent-size">
          {formatBytes(block.size)}
        </span>
      ) : null}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
