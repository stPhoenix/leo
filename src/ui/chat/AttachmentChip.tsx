import { useEffect, useRef } from 'react';
import type { StagedAttachment } from '@/chat/attachmentsStore';

export interface AttachmentChipProps {
  readonly attachment: StagedAttachment;
  readonly onRemove?: (id: string) => void;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function AttachmentChip(props: AttachmentChipProps): JSX.Element {
  const a = props.attachment;
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const removeRef = useRef<HTMLButtonElement | null>(null);
  const isImage = a.kind === 'image';
  const showThumb = isImage && a.previewUrl !== null;

  useEffect(() => {
    const el = iconRef.current;
    if (el === null || showThumb) return;
    el.replaceChildren();
    const glyph = isImage ? 'image' : 'file-text';
    if (props.setIcon !== undefined) props.setIcon(el, glyph);
    else el.textContent = isImage ? '🖼' : '📄';
  }, [isImage, showThumb, props.setIcon]);

  useEffect(() => {
    const el = removeRef.current;
    if (el === null) return;
    el.replaceChildren();
    if (props.setIcon !== undefined) props.setIcon(el, 'x');
    else el.textContent = '×';
  }, [props.setIcon]);

  return (
    <span
      className={`leo-attachment-chip is-${a.kind}`}
      data-slot="attachment-chip"
      data-attachment-id={a.id}
      data-kind={a.kind}
      title={a.name}
    >
      {showThumb ? (
        <img
          className="leo-attachment-thumb"
          src={a.previewUrl ?? ''}
          alt=""
          data-slot="attachment-thumb"
        />
      ) : (
        <span ref={iconRef} className="leo-attachment-icon" data-slot="attachment-icon" />
      )}
      <span className="leo-attachment-name" data-slot="attachment-name">
        {a.name}
      </span>
      <span className="leo-attachment-size" data-slot="attachment-size">
        {formatBytes(a.size)}
      </span>
      {props.onRemove !== undefined ? (
        <button
          ref={removeRef}
          type="button"
          className="leo-attachment-remove"
          aria-label={`Remove ${a.name}`}
          data-slot="attachment-remove"
          onClick={() => props.onRemove?.(a.id)}
        />
      ) : null}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
