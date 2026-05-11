import * as React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { fuzzyFilter } from './fuzzyMatch';
import { SlashPicker, type SlashPickerItem } from './SlashPicker';
import type { SlashCommandInfo } from './slashCommands';
import { AttachmentTray } from './AttachmentTray';
import { AttachmentRejectedNotice, type AttachmentRejection } from './AttachmentRejectedNotice';
import { MentionPicker, type MentionPickerItem } from './MentionPicker';
import type { StagedAttachment } from '@/chat/attachmentsStore';
import type { CaptureFileInput } from '@/chat/attachments';

export interface VaultFileEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: 'image' | 'document';
}

export interface ComposerMatchMedia {
  (query: string): MediaQueryList;
}

export interface ComposerInputProps {
  readonly collapsed: boolean;
  readonly inlineConfirmationOpen?: boolean;
  readonly isSubmitting?: boolean;
  readonly queueLength?: number;
  readonly onSubmit?: (text: string) => void;
  readonly onStopIntent?: () => void;
  readonly onCloseConfirmation?: () => void;
  readonly onOpenCommandPalette?: () => void;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly matchMedia?: ComposerMatchMedia;
  readonly slashCommands?: readonly SlashCommandInfo[];
  readonly attachments?: readonly StagedAttachment[];
  readonly onAttachmentRemove?: (id: string) => void;
  readonly onPickFiles?: () => void;
  readonly onCaptureFiles?: (files: readonly CaptureFileInput[]) => void;
  readonly onCaptureRejected?: (rejections: readonly AttachmentRejection[]) => void;
  readonly attachmentRejections?: readonly AttachmentRejection[];
  readonly onDismissAttachmentRejections?: () => void;
  readonly vaultFiles?: readonly VaultFileEntry[];
  readonly onMentionSelect?: (entry: VaultFileEntry) => void;
}

const SLASH_PICKER_REGEX = /^\s*\/([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z]?[A-Za-z0-9_-]*)?)?$/;

const MENTION_PICKER_REGEX = /(?:^|\s)@([^\s@]*)$/;

const MENTION_PICKER_LIMIT = 8;

const MAX_TEXTAREA_HEIGHT_PX = 280;

export function ComposerInput(props: ComposerInputProps): JSX.Element {
  const [draft, setDraft] = useState<string>('');
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState<number>(0);
  const [mentionActiveIndex, setMentionActiveIndex] = useState<number>(0);
  const [caret, setCaret] = useState<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);
  const attachButtonRef = useRef<HTMLButtonElement | null>(null);

  const submitting = props.isSubmitting === true;
  const confirmationOpen = props.inlineConfirmationOpen === true;
  const queueLength = Math.max(0, props.queueLength ?? 0);
  const draftNonEmpty = draft.trim().length > 0;
  const sendEnabled = draftNonEmpty;

  const slashCommands = props.slashCommands;
  const slashItems = useMemo<readonly SlashPickerItem[]>(() => {
    if (slashCommands === undefined || slashCommands.length === 0) return [];
    const match = SLASH_PICKER_REGEX.exec(draft);
    if (match === null) return [];
    const query = (match[1] ?? '').toLowerCase();
    const ranked = fuzzyFilter(query, slashCommands, (c) => c.name);
    return ranked.map((r) => ({
      name: r.item.name,
      description: r.item.description,
      matches: r.matches,
    }));
  }, [draft, slashCommands]);

  const slashOpen = slashItems.length > 0;

  const vaultFiles = props.vaultFiles;
  const mentionMatch = useMemo(() => {
    if (vaultFiles === undefined || vaultFiles.length === 0) return null;
    if (slashOpen) return null;
    const head = draft.slice(0, caret);
    const m = MENTION_PICKER_REGEX.exec(head);
    if (m === null) return null;
    return {
      query: (m[1] ?? '').toLowerCase(),
      tokenStart: m.index + (m[0].startsWith('@') ? 0 : 1),
    };
  }, [draft, caret, vaultFiles, slashOpen]);

  const mentionItems = useMemo<readonly MentionPickerItem[]>(() => {
    if (mentionMatch === null || vaultFiles === undefined) return [];
    const ranked = fuzzyFilter(mentionMatch.query, vaultFiles, (f) => f.path);
    const top = ranked.slice(0, MENTION_PICKER_LIMIT);
    return top.map((r) => {
      const slash = r.item.path.lastIndexOf('/');
      const folderMatches: number[] = [];
      const nameMatches: number[] = [];
      if (slash < 0) {
        for (const i of r.matches) nameMatches.push(i);
      } else {
        for (const i of r.matches) {
          if (i < slash) folderMatches.push(i);
          else if (i > slash) nameMatches.push(i - slash - 1);
        }
      }
      return {
        path: r.item.path,
        name: r.item.name,
        kind: r.item.kind,
        nameMatches,
        folderMatches,
      };
    });
  }, [mentionMatch, vaultFiles]);

  const mentionOpen = mentionItems.length > 0;

  useEffect(() => {
    if (slashActiveIndex >= slashItems.length) setSlashActiveIndex(0);
  }, [slashItems.length, slashActiveIndex]);

  useEffect(() => {
    if (mentionActiveIndex >= mentionItems.length) setMentionActiveIndex(0);
  }, [mentionItems.length, mentionActiveIndex]);

  const onMentionSelect = props.onMentionSelect;
  const applyMentionSelection = useCallback(
    (item: MentionPickerItem): void => {
      if (mentionMatch === null || vaultFiles === undefined) return;
      const entry = vaultFiles.find((f) => f.path === item.path);
      if (entry === undefined) return;
      const head = draft.slice(0, mentionMatch.tokenStart);
      const tail = draft.slice(caret);
      const next = `${head}${tail}`;
      setDraft(next);
      setMentionActiveIndex(0);
      onMentionSelect?.(entry);
    },
    [draft, caret, mentionMatch, vaultFiles, onMentionSelect],
  );

  const applySlashCompletion = useCallback(
    (item: SlashPickerItem, trailingSpace: boolean): void => {
      const next = trailingSpace ? `/${item.name} ` : `/${item.name}`;
      setDraft(next);
      setSlashActiveIndex(0);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? 'auto' : 'hidden';
  }, [draft]);

  useLayoutEffect(() => {
    const btn = sendButtonRef.current;
    if (btn === null) return;
    btn.replaceChildren();
    const glyph = submitting ? 'square' : 'send';
    if (props.setIcon !== undefined) {
      props.setIcon(btn, glyph);
    } else {
      btn.textContent = submitting ? 'Stop' : 'Send';
    }
  }, [submitting, props.setIcon]);

  useLayoutEffect(() => {
    const btn = attachButtonRef.current;
    if (btn === null) return;
    btn.replaceChildren();
    if (props.setIcon !== undefined) props.setIcon(btn, 'paperclip');
    else btn.textContent = 'Attach';
  }, [props.setIcon, props.onPickFiles]);

  useEffect(() => {
    const mm = props.matchMedia ?? ((q: string) => window.matchMedia(q));
    let mql: MediaQueryList;
    try {
      mql = mm('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    setReduceMotion(mql.matches);
    const handler = (e: MediaQueryListEvent): void => setReduceMotion(e.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    const legacy = mql as MediaQueryList & {
      addListener?: (h: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (h: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(handler);
    return () => legacy.removeListener?.(handler);
  }, [props.matchMedia]);

  const submitDraft = useCallback((): void => {
    if (!draftNonEmpty) return;
    const text = draft;
    setDraft('');
    setSlashActiveIndex(0);
    props.onSubmit?.(text);
  }, [draft, draftNonEmpty, props.onSubmit]);

  const onTextareaChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>): void => {
    setDraft(e.target.value);
    setCaret(e.target.selectionStart ?? e.target.value.length);
  }, []);

  const onTextareaSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const t = e.currentTarget;
    setCaret(t.selectionStart ?? t.value.length);
  }, []);

  const onCaptureFiles = props.onCaptureFiles;
  const onCaptureRejected = props.onCaptureRejected;
  const captureFromFileList = useCallback(
    async (list: FileList | null): Promise<void> => {
      if (list === null || list.length === 0 || onCaptureFiles === undefined) return;
      const out: CaptureFileInput[] = [];
      const failures: AttachmentRejection[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const f = list.item(i);
        if (f === null) continue;
        try {
          const buf = await f.arrayBuffer();
          out.push({
            name: f.name,
            mimeType: f.type !== '' ? f.type : 'application/octet-stream',
            bytes: new Uint8Array(buf),
            size: f.size,
          });
        } catch (err) {
          failures.push({
            name: f.name,
            reason: {
              kind: 'upload_failed',
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
      }
      if (out.length > 0) onCaptureFiles(out);
      if (failures.length > 0) onCaptureRejected?.(failures);
    },
    [onCaptureFiles, onCaptureRejected],
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>): void => {
      const files = e.clipboardData?.files;
      if (files === undefined || files.length === 0) return;
      e.preventDefault();
      void captureFromFileList(files);
    },
    [captureFromFileList],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLElement>): void => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>): void => {
      const files = e.dataTransfer?.files;
      if (files === undefined || files.length === 0) return;
      e.preventDefault();
      void captureFromFileList(files);
    },
    [captureFromFileList],
  );

  const handleEscape = useCallback(
    (e: KeyboardEvent<HTMLElement>): void => {
      e.stopPropagation();
      e.preventDefault();
      if (mentionOpen) {
        setMentionActiveIndex(0);
        textareaRef.current?.focus();
        return;
      }
      if (slashOpen) {
        setDraft('');
        setSlashActiveIndex(0);
        return;
      }
      if (confirmationOpen) {
        props.onCloseConfirmation?.();
        return;
      }
      if (submitting) {
        props.onStopIntent?.();
        return;
      }
      textareaRef.current?.blur();
    },
    [
      mentionOpen,
      slashOpen,
      confirmationOpen,
      submitting,
      props.onCloseConfirmation,
      props.onStopIntent,
    ],
  );

  const handleMentionNav = useCallback(
    (e: KeyboardEvent<HTMLElement>): boolean => {
      if (!mentionOpen) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const len = mentionItems.length;
        setMentionActiveIndex((prev) => (prev + delta + len) % len);
        return true;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const item = mentionItems[mentionActiveIndex] ?? mentionItems[0];
        if (item !== undefined) applyMentionSelection(item);
        return true;
      }
      return false;
    },
    [mentionOpen, mentionItems, mentionActiveIndex, applyMentionSelection],
  );

  const handleSlashNav = useCallback(
    (e: KeyboardEvent<HTMLElement>): boolean => {
      if (!slashOpen) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const len = slashItems.length;
        setSlashActiveIndex((prev) => (prev + delta + len) % len);
        return true;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const item = slashItems[slashActiveIndex] ?? slashItems[0];
        if (item !== undefined) applySlashCompletion(item, true);
        return true;
      }
      return false;
    },
    [slashOpen, slashItems, slashActiveIndex, applySlashCompletion],
  );

  const handleEnterSubmit = useCallback(
    (e: KeyboardEvent<HTMLElement>): void => {
      const native = e.nativeEvent as KeyboardEvent['nativeEvent'] & { isComposing?: boolean };
      if (native.isComposing === true) return;
      if (slashOpen) {
        e.preventDefault();
        const item = slashItems[slashActiveIndex] ?? slashItems[0];
        if (item !== undefined) {
          const text = `/${item.name}`;
          setDraft('');
          setSlashActiveIndex(0);
          props.onSubmit?.(text);
        }
        return;
      }
      e.preventDefault();
      submitDraft();
    },
    [slashOpen, slashItems, slashActiveIndex, props.onSubmit, submitDraft],
  );

  const onRootKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>): void => {
      const isKOnly = !e.shiftKey && !e.altKey;
      if ((e.metaKey || e.ctrlKey) && isKOnly && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenCommandPalette?.();
        return;
      }
      if (e.key === 'Escape') return handleEscape(e);
      if (e.target !== textareaRef.current) return;
      if (handleMentionNav(e)) return;
      if (handleSlashNav(e)) return;
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) handleEnterSubmit(e);
    },
    [props.onOpenCommandPalette, handleEscape, handleMentionNav, handleSlashNav, handleEnterSubmit],
  );

  const onSendClick = useCallback((): void => {
    if (submitting) {
      props.onStopIntent?.();
      return;
    }
    submitDraft();
  }, [submitting, submitDraft, props.onStopIntent]);

  const sendAriaLabel = submitting ? 'Stop response' : 'Send message';
  const sendDisabled = submitting ? false : !sendEnabled;
  const rootClass = [
    'leo-composer-input',
    props.collapsed ? 'is-collapsed' : '',
    submitting ? 'is-submitting' : '',
    reduceMotion ? 'is-reduced-motion' : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  const attachments = props.attachments ?? [];
  const rejections = props.attachmentRejections ?? [];

  return (
    // NOSONAR S6847 — composer region with keyboard shortcuts (Esc, slash menu) + paste/drop file capture; semantically a form region
    <section
      className={rootClass}
      aria-label="composer"
      data-region="composer"
      data-submitting={submitting ? 'true' : 'false'}
      data-reduced-motion={reduceMotion ? 'true' : 'false'}
      onKeyDown={onRootKeyDown}
      onDragOver={onCaptureFiles !== undefined ? onDragOver : undefined}
      onDrop={onCaptureFiles !== undefined ? onDrop : undefined}
    >
      {attachments.length > 0 ? (
        <AttachmentTray
          items={attachments}
          onRemove={props.onAttachmentRemove}
          setIcon={props.setIcon}
        />
      ) : null}
      {rejections.length > 0 ? (
        <AttachmentRejectedNotice
          rejections={rejections}
          onDismiss={props.onDismissAttachmentRejections}
        />
      ) : null}
      <textarea
        ref={textareaRef}
        className="leo-composer-textarea"
        placeholder="Type a message…"
        rows={1}
        value={draft}
        onChange={onTextareaChange}
        onSelect={onTextareaSelect}
        onPaste={onCaptureFiles !== undefined ? onPaste : undefined}
        aria-describedby="leo-composer-hint"
        aria-multiline="true"
        data-slot="composer-textarea"
      />
      {props.onPickFiles !== undefined ? (
        <button
          ref={attachButtonRef}
          type="button"
          className="leo-composer-attach"
          aria-label="Attach file"
          onClick={props.onPickFiles}
          data-slot="composer-attach"
        />
      ) : null}
      <button
        ref={sendButtonRef}
        type="button"
        className="leo-composer-send"
        aria-label={sendAriaLabel}
        aria-disabled={sendDisabled ? 'true' : 'false'}
        disabled={sendDisabled}
        onClick={onSendClick}
        data-slot="composer-send"
      />
      <span id="leo-composer-hint" className="leo-composer-hint" data-slot="composer-hint">
        {submitting
          ? 'Waiting for reply — press Esc to stop.'
          : 'Enter to send, Shift+Enter for newline.'}
      </span>
      {queueLength > 0 ? (
        <span
          className="leo-composer-queue"
          data-slot="composer-queue"
          role="status"
          aria-live="polite"
        >
          {queueLength === 1 ? '1 message queued' : `${queueLength} messages queued`}
        </span>
      ) : null}
      {slashOpen ? (
        <SlashPicker
          items={slashItems}
          activeIndex={slashActiveIndex}
          onSelect={(item) => {
            setDraft('');
            setSlashActiveIndex(0);
            props.onSubmit?.(`/${item.name}`);
            textareaRef.current?.focus();
          }}
          onHover={(i) => setSlashActiveIndex(i)}
        />
      ) : null}
      {mentionOpen ? (
        <MentionPicker
          items={mentionItems}
          activeIndex={mentionActiveIndex}
          onSelect={(item) => applyMentionSelection(item)}
          onHover={(i) => setMentionActiveIndex(i)}
          setIcon={props.setIcon}
        />
      ) : null}
    </section>
  );
}
