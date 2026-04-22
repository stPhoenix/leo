import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ChatMessageRecord } from '@/chat/types';
import type { ChatMessageStore } from '@/chat/messageStore';
import { enhanceCodeBlocks, type CodeBlockClipboard } from './codeBlockEnhancer';
import { isNearBottom } from './scrollAnchoring';
import { InlineEditor, MessageActionBar, type MessageActions } from './MessageActionBar';
import { lookupWidget } from './widgets/registry';

export interface MarkdownRenderFn {
  (text: string, container: HTMLElement): (() => void) | void;
}

export interface MessageListProps {
  readonly store: ChatMessageStore;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly actions?: MessageActions;
  readonly resolveCostUSD?: (usage: { input: number; output: number }) => number | null;
}

export function MessageList(props: MessageListProps): JSX.Element {
  const messages = useSyncExternalStore<readonly ChatMessageRecord[]>(
    props.store.subscribe,
    props.store.getSnapshot,
    props.store.getSnapshot,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef<boolean>(true);
  const [pendingNew, setPendingNew] = useState<number>(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const startEdit = useCallback((id: string) => setEditingId(id), []);
  const endEdit = useCallback(() => setEditingId(null), []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setPendingNew(0);
    } else {
      setPendingNew((prev) => prev + 1);
    }
  }, [messages.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const onScroll = (): void => {
      wasAtBottomRef.current = isNearBottom({
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
      if (wasAtBottomRef.current) setPendingNew(0);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const jumpToLatest = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
    setPendingNew(0);
  };

  return (
    <section
      className="leo-message-list"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="conversation"
      data-region="messages"
    >
      <div className="leo-message-list-scroll" ref={scrollRef} data-slot="scroll-host">
        {messages.length === 0 ? (
          <div className="leo-message-list-empty" data-slot="empty-state">
            Start a conversation — Leo's responses will appear here.
          </div>
        ) : (
          <ol className="leo-message-list-items">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`leo-message leo-message-${m.role}`}
                data-role={m.role}
                role="listitem"
              >
                {m.role === 'user' ? (
                  <UserBubble
                    record={m}
                    {...(props.actions !== undefined ? { actions: props.actions } : {})}
                    {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
                    editing={editingId === m.id}
                    onStartEdit={startEdit}
                    onFinishEdit={endEdit}
                  />
                ) : m.role === 'banner' ? (
                  <BannerRow record={m} />
                ) : m.role === 'widget' ? (
                  <WidgetRow record={m} />
                ) : (
                  <AssistantBubble
                    record={m}
                    renderMarkdown={props.renderMarkdown}
                    clipboard={props.clipboard}
                    setIcon={props.setIcon}
                    {...(props.actions !== undefined ? { actions: props.actions } : {})}
                    {...(props.resolveCostUSD !== undefined
                      ? { resolveCostUSD: props.resolveCostUSD }
                      : {})}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {pendingNew > 0 ? (
        <button
          type="button"
          className="leo-jump-to-latest"
          onClick={jumpToLatest}
          aria-label={`Jump to latest (${pendingNew} new)`}
        >
          ↓ Jump to latest ({pendingNew})
        </button>
      ) : null}
    </section>
  );
}

interface UserBubbleProps {
  readonly record: ChatMessageRecord;
  readonly actions?: MessageActions;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly editing: boolean;
  readonly onStartEdit: (id: string) => void;
  readonly onFinishEdit: () => void;
}

function UserBubble(props: UserBubbleProps): JSX.Element {
  const { record } = props;
  if (props.editing && props.actions?.editAndResend !== undefined) {
    return (
      <div className="leo-bubble leo-bubble-user is-editing">
        <header className="leo-bubble-header">user · {record.createdAt}</header>
        <InlineEditor
          initial={record.content}
          onSave={(text) => {
            props.actions!.editAndResend!(record.id, text);
            props.onFinishEdit();
          }}
          onCancel={props.onFinishEdit}
        />
      </div>
    );
  }
  return (
    <div className="leo-bubble leo-bubble-user">
      <header className="leo-bubble-header">user · {record.createdAt}</header>
      <div className="leo-bubble-body" data-slot="user-text">
        {record.content}
      </div>
      {props.actions !== undefined ? (
        <MessageActionBar
          record={record}
          actions={props.actions}
          {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
          onStartEdit={props.onStartEdit}
        />
      ) : null}
    </div>
  );
}

interface AssistantBubbleProps {
  readonly record: ChatMessageRecord;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly actions?: MessageActions;
  readonly resolveCostUSD?: (usage: { input: number; output: number }) => number | null;
}

function AssistantBubble(props: AssistantBubbleProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    host.replaceChildren();
    const cleanupMarkdown = props.renderMarkdown(props.record.content, host);
    const cleanupCodeButtons = enhanceCodeBlocks(host, {
      clipboard: props.clipboard,
      ...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {}),
    });
    return () => {
      cleanupCodeButtons();
      if (typeof cleanupMarkdown === 'function') cleanupMarkdown();
      host.replaceChildren();
    };
  }, [props.record.id, props.record.content, props.renderMarkdown, props.clipboard, props.setIcon]);

  const status = props.record.status;
  const streaming = status === 'streaming';
  const classes = [
    'leo-bubble',
    'leo-bubble-assistant',
    streaming ? 'is-streaming' : '',
    status !== undefined ? `status-${status}` : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  return (
    <div className={classes} data-status={status ?? 'done'}>
      <header className="leo-bubble-header">assistant · {props.record.createdAt}</header>
      <div className="leo-bubble-body" data-slot="assistant-markdown" ref={hostRef} />
      {streaming ? (
        <span className="leo-streaming-cursor" data-slot="streaming-cursor" aria-hidden="true" />
      ) : null}
      {!streaming && props.record.tokens !== undefined ? (
        <TokenUsageFooter
          input={props.record.tokens.input}
          output={props.record.tokens.output}
          total={props.record.tokens.total}
          estimatedInput={props.record.tokens.estimatedInput === true}
          estimatedOutput={props.record.tokens.estimatedOutput === true}
          costUSD={props.resolveCostUSD?.({
            input: props.record.tokens.input,
            output: props.record.tokens.output,
          })}
        />
      ) : null}
      {!streaming && props.actions !== undefined ? (
        <MessageActionBar
          record={props.record}
          actions={props.actions}
          {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
        />
      ) : null}
    </div>
  );
}

interface TokenUsageFooterProps {
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly estimatedInput: boolean;
  readonly estimatedOutput: boolean;
  readonly costUSD?: number | null;
}

function TokenUsageFooter(props: TokenUsageFooterProps): JSX.Element {
  const totalEstimated = props.estimatedInput || props.estimatedOutput;
  const prefix = (est: boolean): string => (est ? '~' : '');
  return (
    <footer className="leo-bubble-usage" data-slot="assistant-usage" aria-label="token usage">
      <span data-slot="usage-input" data-estimated={props.estimatedInput ? 'true' : 'false'}>
        input {prefix(props.estimatedInput)}
        {props.input}
      </span>
      <span data-slot="usage-output" data-estimated={props.estimatedOutput ? 'true' : 'false'}>
        output {prefix(props.estimatedOutput)}
        {props.output}
      </span>
      <span data-slot="usage-total" data-estimated={totalEstimated ? 'true' : 'false'}>
        total {prefix(totalEstimated)}
        {props.total}
      </span>
      {typeof props.costUSD === 'number' && props.costUSD > 0 ? (
        <span data-slot="usage-cost">{formatCostInline(props.costUSD)}</span>
      ) : null}
    </footer>
  );
}

function formatCostInline(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function WidgetRow({ record }: { record: ChatMessageRecord }): JSX.Element {
  const widget = record.widget;
  if (widget === undefined) {
    return (
      <div className="leo-widget leo-widget-missing" data-slot="widget-missing">
        widget payload missing
      </div>
    );
  }
  const Component = lookupWidget(widget.kind);
  if (Component === null) {
    return (
      <div
        className="leo-widget leo-widget-unknown"
        data-slot="widget-unknown"
        data-widget-kind={widget.kind}
      >
        unknown widget: {widget.kind}
      </div>
    );
  }
  return (
    <div
      className={`leo-widget leo-widget-${widget.kind}`}
      data-slot="widget"
      data-widget-kind={widget.kind}
    >
      <Component props={widget.props} />
    </div>
  );
}

function BannerRow({ record }: { record: ChatMessageRecord }): JSX.Element {
  const kind = record.banner?.kind ?? 'cancelled';
  const preformatted = kind === 'info';
  return (
    <div
      className={`leo-banner leo-banner-${kind}`}
      role="status"
      data-slot={`banner-${kind}`}
      data-banner-kind={kind}
      data-tool-count={record.banner?.toolCount ?? ''}
      {...(preformatted
        ? { style: { whiteSpace: 'pre', fontFamily: 'var(--font-monospace)' } }
        : {})}
    >
      {record.content}
    </div>
  );
}
