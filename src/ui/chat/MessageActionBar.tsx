import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessageRecord } from '@/chat/types';

export interface MessageActions {
  readonly copy: (record: ChatMessageRecord) => void | Promise<void>;
  readonly delete: (id: string) => void;
  readonly regenerate?: (id: string) => void;
  readonly editAndResend?: (id: string, newContent: string) => void;
}

export interface MessageActionBarProps {
  readonly record: ChatMessageRecord;
  readonly actions: MessageActions;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly onStartEdit?: (id: string) => void;
}

export function MessageActionBar(props: MessageActionBarProps): JSX.Element | null {
  const { record, actions } = props;
  const copyBtn = useIconButton(props.setIcon, 'copy');
  const regenBtn = useIconButton(props.setIcon, 'refresh-cw');
  const editBtn = useIconButton(props.setIcon, 'pencil');
  const delBtn = useIconButton(props.setIcon, 'trash-2');
  if (record.role === 'banner') return null;
  const isAssistant = record.role === 'assistant';
  const isUser = record.role === 'user';

  return (
    <div
      className="leo-message-actions"
      data-slot="message-actions"
      role="toolbar"
      aria-label="message actions"
    >
      <button
        ref={copyBtn}
        type="button"
        className="leo-message-action"
        data-slot="message-action-copy"
        aria-label="Copy message"
        onClick={() => {
          void Promise.resolve(actions.copy(record));
        }}
      >
        Copy
      </button>
      {isAssistant && actions.regenerate !== undefined ? (
        <button
          ref={regenBtn}
          type="button"
          className="leo-message-action"
          data-slot="message-action-regenerate"
          aria-label="Regenerate response"
          onClick={() => actions.regenerate?.(record.id)}
        >
          Regenerate
        </button>
      ) : null}
      {isUser && actions.editAndResend !== undefined && props.onStartEdit !== undefined ? (
        <button
          ref={editBtn}
          type="button"
          className="leo-message-action"
          data-slot="message-action-edit"
          aria-label="Edit and resend message"
          onClick={() => props.onStartEdit?.(record.id)}
        >
          Edit
        </button>
      ) : null}
      <button
        ref={delBtn}
        type="button"
        className="leo-message-action"
        data-slot="message-action-delete"
        aria-label="Delete message"
        onClick={() => actions.delete(record.id)}
      >
        Delete
      </button>
    </div>
  );
}

function useIconButton(
  setIcon: ((el: HTMLElement, name: string) => void) | undefined,
  iconName: string,
) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || setIcon === undefined) return;
    el.replaceChildren();
    setIcon(el, iconName);
  }, [setIcon, iconName]);
  return ref;
}

export interface InlineEditorProps {
  readonly initial: string;
  readonly onSave: (text: string) => void;
  readonly onCancel: () => void;
}

export function InlineEditor(props: InlineEditorProps): JSX.Element {
  const [text, setText] = useState<string>(props.initial);
  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onCancel();
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        props.onSave(text);
      }
    },
    [text, props],
  );
  return (
    <div className="leo-inline-editor" data-slot="inline-editor">
      <textarea
        className="leo-inline-editor-textarea"
        data-slot="inline-editor-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={3}
        autoFocus
        aria-label="Edit message"
      />
      <div className="leo-inline-editor-actions">
        <button
          type="button"
          className="leo-message-action"
          data-slot="inline-editor-save"
          onClick={() => props.onSave(text)}
          aria-label="Save edits and resend"
        >
          Save
        </button>
        <button
          type="button"
          className="leo-message-action"
          data-slot="inline-editor-cancel"
          onClick={props.onCancel}
          aria-label="Cancel edit"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
