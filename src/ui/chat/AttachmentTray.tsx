import type { StagedAttachment } from '@/chat/attachmentsStore';
import { AttachmentChip } from './AttachmentChip';

export interface AttachmentTrayProps {
  readonly items: readonly StagedAttachment[];
  readonly onRemove?: (id: string) => void;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function AttachmentTray(props: AttachmentTrayProps): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <div
      className="leo-attachment-tray"
      role="list"
      aria-label="staged attachments"
      data-slot="attachment-tray"
    >
      {props.items.map((a) => (
        <div key={a.id} role="listitem" className="leo-attachment-tray-item">
          <AttachmentChip attachment={a} onRemove={props.onRemove} setIcon={props.setIcon} />
        </div>
      ))}
    </div>
  );
}
