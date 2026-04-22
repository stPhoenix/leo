import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { fuzzyFilter } from './fuzzyMatch';
import { SlashPicker, type SlashPickerItem } from './SlashPicker';
import type { SlashCommandInfo } from './slashCommands';

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
}

const SLASH_PICKER_REGEX = /^\s*\/([A-Za-z][A-Za-z0-9_-]*)?$/;

const MAX_TEXTAREA_HEIGHT_PX = 280;

export function ComposerInput(props: ComposerInputProps): JSX.Element {
  const [draft, setDraft] = useState<string>('');
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendButtonRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (slashActiveIndex >= slashItems.length) setSlashActiveIndex(0);
  }, [slashItems.length, slashActiveIndex]);

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
  }, []);

  const onRootKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>): void => {
      const isKOnly = !e.shiftKey && !e.altKey;
      if ((e.metaKey || e.ctrlKey) && isKOnly && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        props.onOpenCommandPalette?.();
        return;
      }

      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
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
        return;
      }

      if (e.target !== textareaRef.current) return;

      if (slashOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const len = slashItems.length;
        setSlashActiveIndex((prev) => (prev + delta + len) % len);
        return;
      }

      if (slashOpen && e.key === 'Tab') {
        e.preventDefault();
        const item = slashItems[slashActiveIndex] ?? slashItems[0];
        if (item !== undefined) applySlashCompletion(item, true);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
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
      }
    },
    [
      confirmationOpen,
      submitting,
      submitDraft,
      slashOpen,
      slashItems,
      slashActiveIndex,
      applySlashCompletion,
      props.onOpenCommandPalette,
      props.onCloseConfirmation,
      props.onStopIntent,
      props.onSubmit,
    ],
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

  return (
    <section
      className={rootClass}
      aria-label="composer"
      data-region="composer"
      data-submitting={submitting ? 'true' : 'false'}
      data-reduced-motion={reduceMotion ? 'true' : 'false'}
      onKeyDown={onRootKeyDown}
    >
      <textarea
        ref={textareaRef}
        className="leo-composer-textarea"
        placeholder="Type a message…"
        rows={1}
        value={draft}
        onChange={onTextareaChange}
        aria-describedby="leo-composer-hint"
        aria-multiline="true"
        data-slot="composer-textarea"
      />
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
    </section>
  );
}
