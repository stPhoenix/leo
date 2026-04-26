import type { AttachmentRejectReason } from '@/chat/attachments';

export type AttachmentRejection =
  | { readonly name: string; readonly reason: AttachmentRejectReason }
  | { readonly name: string; readonly reason: { readonly kind: 'vision_blocked' } };

export interface AttachmentRejectedNoticeProps {
  readonly rejections: readonly AttachmentRejection[];
  readonly onDismiss?: () => void;
}

export function AttachmentRejectedNotice(props: AttachmentRejectedNoticeProps): JSX.Element | null {
  if (props.rejections.length === 0) return null;
  return (
    <div
      className="leo-attachment-rejected"
      role="status"
      aria-live="polite"
      data-slot="attachment-rejected"
    >
      <ul className="leo-attachment-rejected-list">
        {props.rejections.map((r, i) => (
          <li key={`${r.name}-${i}`} className="leo-attachment-rejected-item">
            <span className="leo-attachment-rejected-name">{r.name}</span>
            <span className="leo-attachment-rejected-reason">{describe(r.reason)}</span>
          </li>
        ))}
      </ul>
      {props.onDismiss !== undefined ? (
        <button
          type="button"
          className="leo-attachment-rejected-dismiss"
          aria-label="Dismiss"
          onClick={props.onDismiss}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function describe(reason: AttachmentRejection['reason']): string {
  switch (reason.kind) {
    case 'oversize':
      return `too large (${formatBytes(reason.size)})`;
    case 'limit_reached':
      return `limit reached (${reason.currentCount} attached)`;
    case 'unsupported_mime':
      return `unsupported type: ${reason.mimeType}`;
    case 'vision_blocked':
      return 'current model does not support images';
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
