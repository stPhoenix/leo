import { useEffect, useRef } from 'react';
import type { AttachmentChipBlock } from '@/chat/types';

export interface SentAttachmentListProps {
  readonly chips: readonly AttachmentChipBlock[];
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function SentAttachmentList(props: SentAttachmentListProps): JSX.Element | null {
  if (props.chips.length === 0) return null;
  return (
    <ul className="leo-sent-attachments" aria-label="sent attachments" data-slot="sent-attachments">
      {props.chips.map((c, i) => (
        <SentAttachmentChip key={`${c.kind}-${i}-${c.name}`} chip={c} setIcon={props.setIcon} />
      ))}
    </ul>
  );
}

function SentAttachmentChip(props: {
  readonly chip: AttachmentChipBlock;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}): JSX.Element {
  const { chip } = props;
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const isImage = chip.kind === 'image';

  useEffect(() => {
    const el = iconRef.current;
    if (el === null) return;
    el.replaceChildren();
    const glyph = isImage ? 'image' : 'file-text';
    if (props.setIcon !== undefined) props.setIcon(el, glyph);
    else el.textContent = isImage ? '🖼' : '📄';
  }, [isImage, props.setIcon]);

  return (
    <li
      className={`leo-attachment-chip is-${chip.kind} is-sent`}
      data-slot="sent-attachment"
      data-kind={chip.kind}
      title={chip.name}
    >
      <span ref={iconRef} className="leo-attachment-icon" data-slot="sent-icon" />
      <span className="leo-attachment-name" data-slot="sent-name">
        {chip.name}
      </span>
      <span className="leo-attachment-size" data-slot="sent-size">
        {formatBytes(chip.size)}
      </span>
    </li>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
