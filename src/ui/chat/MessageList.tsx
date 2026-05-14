import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AttachmentChipBlock, ChatMessageRecord } from '@/chat/types';
import type { ChatMessageStore } from '@/chat/messageStore';
import { enhanceCodeBlocks, type CodeBlockClipboard } from './codeBlockEnhancer';
import { isNearBottom } from './scrollAnchoring';
import { InlineEditor, MessageActionBar, type MessageActions } from './MessageActionBar';
import { lookupWidget } from './widgets/registry';
import { AssistantBlocks, SlashExpandedBlockView, type ToolUseBlockSlots } from './blocks';
import { SentAttachmentList } from './SentAttachmentList';

export interface MarkdownRenderFn {
  (text: string, container: HTMLElement): (() => void) | void;
}

function formatBubbleTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date} · ${time}`;
}

export interface MessageListProps {
  readonly store: ChatMessageStore;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly actions?: MessageActions;
  readonly toolUseSlots?: ToolUseBlockSlots;
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
              <li key={m.id} className={`leo-message leo-message-${m.role}`} data-role={m.role}>
                {renderMessageRow({
                  m,
                  props,
                  editing: editingId === m.id,
                  startEdit,
                  endEdit,
                })}
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

function renderMessageRow(args: {
  readonly m: ChatMessageRecord;
  readonly props: MessageListProps;
  readonly editing: boolean;
  readonly startEdit: (id: string) => void;
  readonly endEdit: () => void;
}): JSX.Element {
  const { m, props, editing, startEdit, endEdit } = args;
  if (m.role === 'user') {
    return (
      <UserBubble
        record={m}
        actions={props.actions}
        setIcon={props.setIcon}
        editing={editing}
        onStartEdit={startEdit}
        onFinishEdit={endEdit}
        renderMarkdown={props.renderMarkdown}
        clipboard={props.clipboard}
      />
    );
  }
  if (m.role === 'banner') return <BannerRow record={m} />;
  if (m.role === 'widget') return <WidgetRow record={m} />;
  return (
    <AssistantBubble
      record={m}
      renderMarkdown={props.renderMarkdown}
      clipboard={props.clipboard}
      setIcon={props.setIcon}
      actions={props.actions}
      toolUseSlots={props.toolUseSlots}
    />
  );
}

interface UserBubbleProps {
  readonly record: ChatMessageRecord;
  readonly actions?: MessageActions;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly editing: boolean;
  readonly onStartEdit: (id: string) => void;
  readonly onFinishEdit: () => void;
  readonly renderMarkdown?: MarkdownRenderFn;
  readonly clipboard?: CodeBlockClipboard;
}

function UserBubble(props: UserBubbleProps): JSX.Element {
  const { record } = props;
  if (props.editing && props.actions?.editAndResend !== undefined) {
    return (
      <div className="leo-bubble leo-bubble-user is-editing">
        <header className="leo-bubble-header">
          <span className="leo-bubble-role">You</span>
          <time className="leo-bubble-time" dateTime={record.createdAt}>
            {formatBubbleTime(record.createdAt)}
          </time>
        </header>
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
  const userBlocks = record.blocks ?? [];
  const chips = userBlocks.filter((b): b is AttachmentChipBlock => b.type === 'attachment_chip');
  const slashExpanded = userBlocks.filter((b) => b.type === 'slash_expanded');
  return (
    <div className="leo-bubble leo-bubble-user">
      <header className="leo-bubble-header">
        <span className="leo-bubble-role">You</span>
        <time className="leo-bubble-time" dateTime={record.createdAt}>
          {formatBubbleTime(record.createdAt)}
        </time>
      </header>
      {chips.length > 0 ? <SentAttachmentList chips={chips} setIcon={props.setIcon} /> : null}
      <div className="leo-bubble-body" data-slot="user-text">
        {record.content}
      </div>
      {slashExpanded.map((b, i) =>
        b.type === 'slash_expanded' ? (
          <SlashExpandedBlockView
            key={`${record.id}:slash:${i}`}
            block={b}
            blockId={`${record.id}:slash:${i}`}
            {...(props.renderMarkdown !== undefined
              ? { renderMarkdown: props.renderMarkdown }
              : {})}
            {...(props.clipboard !== undefined ? { clipboard: props.clipboard } : {})}
            {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
          />
        ) : null,
      )}
      {props.actions !== undefined ? (
        <MessageActionBar
          record={record}
          actions={props.actions}
          setIcon={props.setIcon}
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
  readonly toolUseSlots?: ToolUseBlockSlots;
}

function AssistantBubble(props: AssistantBubbleProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const blocks = props.record.blocks;
  const useBlocks = blocks !== undefined && blocks.length > 0;

  useEffect(() => {
    if (useBlocks) return;
    const host = hostRef.current;
    if (host === null) return;
    host.replaceChildren();
    const cleanupMarkdown = props.renderMarkdown(props.record.content, host);
    const cleanupCodeButtons = enhanceCodeBlocks(host, {
      clipboard: props.clipboard,
      setIcon: props.setIcon,
    });
    return () => {
      cleanupCodeButtons();
      if (typeof cleanupMarkdown === 'function') cleanupMarkdown();
      host.replaceChildren();
    };
  }, [
    useBlocks,
    props.record.id,
    props.record.content,
    props.renderMarkdown,
    props.clipboard,
    props.setIcon,
  ]);

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

  const lastBlockIsText = useBlocks && blocks![blocks!.length - 1]?.type === 'text';

  return (
    <div className={classes} data-status={status ?? 'done'}>
      <header className="leo-bubble-header">
        <span className="leo-bubble-role">Leo</span>
        <time className="leo-bubble-time" dateTime={props.record.createdAt}>
          {formatBubbleTime(props.record.createdAt)}
        </time>
      </header>
      {useBlocks ? (
        <AssistantBlocks
          messageId={props.record.id}
          blocks={blocks!}
          streaming={streaming}
          renderMarkdown={props.renderMarkdown}
          clipboard={props.clipboard}
          setIcon={props.setIcon}
          toolUseSlots={props.toolUseSlots}
        />
      ) : (
        <div className="leo-bubble-body" data-slot="assistant-markdown" ref={hostRef} />
      )}
      {streaming && !useBlocks ? (
        <span className="leo-streaming-cursor" data-slot="streaming-cursor" aria-hidden="true" />
      ) : null}
      {streaming && useBlocks && !lastBlockIsText ? (
        <span
          className="leo-streaming-cursor"
          data-slot="streaming-cursor-trailing"
          aria-hidden="true"
        />
      ) : null}
      {!streaming && props.record.tokens !== undefined ? (
        <TokenUsageFooter
          input={props.record.tokens.input}
          output={props.record.tokens.output}
          total={props.record.tokens.total}
          estimatedInput={props.record.tokens.estimatedInput === true}
          estimatedOutput={props.record.tokens.estimatedOutput === true}
          reasoning={props.record.tokens.reasoning}
          cacheCreation={props.record.tokens.cacheCreation}
          cacheRead={props.record.tokens.cacheRead}
        />
      ) : null}
      {!streaming && props.actions !== undefined ? (
        <MessageActionBar record={props.record} actions={props.actions} setIcon={props.setIcon} />
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
  readonly reasoning?: number;
  readonly cacheCreation?: number;
  readonly cacheRead?: number;
}

function CacheBreakdown({
  cacheRead,
  cacheCreation,
}: {
  readonly cacheRead?: number;
  readonly cacheCreation?: number;
}): JSX.Element | null {
  const readActive = cacheRead !== undefined && cacheRead > 0;
  const writeActive = cacheCreation !== undefined && cacheCreation > 0;
  if (!readActive && !writeActive) return null;
  return (
    <span className="leo-usage-cache" data-slot="usage-cache">
      {' '}
      ({readActive ? <span data-slot="usage-cache-read">cache hit {cacheRead}</span> : null}
      {readActive && writeActive ? ', ' : ''}
      {writeActive ? <span data-slot="usage-cache-write">cache write {cacheCreation}</span> : null})
    </span>
  );
}

function ReasoningBreakdown({ reasoning }: { readonly reasoning?: number }): JSX.Element | null {
  if (reasoning === undefined || reasoning <= 0) return null;
  return (
    <span className="leo-usage-reasoning" data-slot="usage-reasoning">
      {' '}
      (thinking {reasoning})
    </span>
  );
}

function TokenUsageFooter(props: TokenUsageFooterProps): JSX.Element {
  const totalEstimated = props.estimatedInput || props.estimatedOutput;
  const prefix = (est: boolean): string => (est ? '~' : '');
  return (
    <footer className="leo-bubble-usage" data-slot="assistant-usage" aria-label="token usage">
      <span data-slot="usage-input" data-estimated={props.estimatedInput ? 'true' : 'false'}>
        input {prefix(props.estimatedInput)}
        {props.input}
        <CacheBreakdown
          {...(props.cacheRead !== undefined ? { cacheRead: props.cacheRead } : {})}
          {...(props.cacheCreation !== undefined ? { cacheCreation: props.cacheCreation } : {})}
        />
      </span>
      <span data-slot="usage-output" data-estimated={props.estimatedOutput ? 'true' : 'false'}>
        output {prefix(props.estimatedOutput)}
        {props.output}
        <ReasoningBreakdown
          {...(props.reasoning !== undefined ? { reasoning: props.reasoning } : {})}
        />
      </span>
      <span data-slot="usage-total" data-estimated={totalEstimated ? 'true' : 'false'}>
        total {prefix(totalEstimated)}
        {props.total}
      </span>
    </footer>
  );
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
