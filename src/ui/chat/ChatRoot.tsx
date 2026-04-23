import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HeaderBar } from './HeaderBar';
import { ContextIndicator, type ContextIndicatorSource } from './ContextIndicator';
import { MessageList, type MarkdownRenderFn } from './MessageList';
import type { MessageActions } from './MessageActionBar';
import { ComposerInput, type ComposerInputProps } from './ComposerInput';
import { InlineConfirmation, type InlineConfirmationSource } from './InlineConfirmation';
import { InlineDialog, type AcceptRejectSource } from './InlineDialog';
import {
  PlanApprovalDialog,
  type PlanApprovalSource,
  type PlanMarkdownRenderFn,
} from './PlanApprovalDialog';
import { SkillPicker, type SkillPickerSource } from './SkillPicker';
import { ThreadSwitcher, type ThreadsUiSource } from './ThreadSwitcher';
import { IndexEmptyStateCta, type IndexStatusSource } from './IndexEmptyStateCta';
import type { DrainListener } from '@/indexer/vaultIndexer';
import { isCollapsed } from '../responsiveCollapse';
import type { ChatMessageStore } from '@/chat/messageStore';
import type { StreamingPhase } from '@/chat/streamingController';
import type { CodeBlockClipboard } from './codeBlockEnhancer';

export type ComposerHooks = Partial<Omit<ComposerInputProps, 'collapsed' | 'setIcon'>>;

export interface PhaseSource {
  readonly getPhase: () => StreamingPhase;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface QueueSource {
  readonly getLength: () => number;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface ChatRootProps {
  readonly initialWidth?: number;
  readonly observeWidth?: (cb: (w: number) => void) => () => void;
  readonly onOverflowMenu?: (anchor: HTMLElement) => void;
  readonly messageStore: ChatMessageStore;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly composer?: ComposerHooks;
  readonly phaseSource?: PhaseSource;
  readonly queueSource?: QueueSource;
  readonly contextIndicatorSource?: ContextIndicatorSource;
  readonly onRevealContextFile?: (file: string) => void;
  readonly messageActions?: MessageActions;
  readonly confirmationSource?: InlineConfirmationSource;
  readonly acceptRejectSource?: AcceptRejectSource;
  readonly planApprovalSource?: PlanApprovalSource;
  readonly renderPlanMarkdown?: PlanMarkdownRenderFn;
  readonly skillPickerSource?: SkillPickerSource;
  readonly threadsSource?: ThreadsUiSource;
  readonly indexStatusSource?: IndexStatusSource;
  readonly indexDrainSubscribe?: (listener: DrainListener) => () => void;
  readonly onIndexVault?: () => void;
  readonly resolveCostUSD?: (usage: { input: number; output: number }) => number | null;
}

const STATIC_IDLE_PHASE: StreamingPhase = 'idle';
const STATIC_IDLE_SOURCE: PhaseSource = {
  getPhase: () => STATIC_IDLE_PHASE,
  subscribe: () => () => undefined,
};
const STATIC_EMPTY_QUEUE: QueueSource = {
  getLength: () => 0,
  subscribe: () => () => undefined,
};

export function ChatRoot(props: ChatRootProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(isCollapsed(props.initialWidth ?? 0));
  const rootRef = useRef<HTMLDivElement>(null);
  const phaseSource = props.phaseSource ?? STATIC_IDLE_SOURCE;
  const phase = useSyncExternalStore<StreamingPhase>(
    phaseSource.subscribe,
    phaseSource.getPhase,
    phaseSource.getPhase,
  );
  const queueSource = props.queueSource ?? STATIC_EMPTY_QUEUE;
  const queueLength = useSyncExternalStore<number>(
    queueSource.subscribe,
    queueSource.getLength,
    queueSource.getLength,
  );
  const isSubmitting = phase === 'streaming' || phase === 'cancelling';

  useEffect(() => {
    const observe = props.observeWidth;
    if (observe === undefined) return;
    const unsubscribe = observe((w) => setCollapsed(isCollapsed(w)));
    return () => unsubscribe();
  }, [props.observeWidth]);

  return (
    <div
      ref={rootRef}
      className={`leo-chat-root${collapsed ? ' is-collapsed' : ''}`}
      data-region="root"
    >
      <HeaderBar
        collapsed={collapsed}
        onOverflowMenu={props.onOverflowMenu}
        {...(props.skillPickerSource !== undefined
          ? { skillPicker: <SkillPicker source={props.skillPickerSource} collapsed={collapsed} /> }
          : {})}
        {...(props.threadsSource !== undefined
          ? { threadSwitcher: <ThreadSwitcher source={props.threadsSource} /> }
          : {})}
      />
      <ContextIndicator
        collapsed={collapsed}
        {...(props.contextIndicatorSource !== undefined
          ? { source: props.contextIndicatorSource }
          : {})}
        {...(props.onRevealContextFile !== undefined
          ? { onReveal: props.onRevealContextFile }
          : {})}
      />
      <IndexEmptyStateCta
        {...(props.indexStatusSource !== undefined ? { source: props.indexStatusSource } : {})}
        {...(props.indexDrainSubscribe !== undefined
          ? { drainSubscribe: props.indexDrainSubscribe }
          : {})}
        {...(props.onIndexVault !== undefined ? { onIndexVault: props.onIndexVault } : {})}
      />
      <MessageList
        store={props.messageStore}
        renderMarkdown={props.renderMarkdown}
        clipboard={props.clipboard}
        {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
        {...(props.messageActions !== undefined ? { actions: props.messageActions } : {})}
        {...(props.resolveCostUSD !== undefined ? { resolveCostUSD: props.resolveCostUSD } : {})}
      />
      <InlineConfirmation
        {...(props.confirmationSource !== undefined ? { source: props.confirmationSource } : {})}
      />
      <InlineDialog
        {...(props.acceptRejectSource !== undefined ? { source: props.acceptRejectSource } : {})}
      />
      <PlanApprovalDialog
        {...(props.planApprovalSource !== undefined ? { source: props.planApprovalSource } : {})}
        {...(props.renderPlanMarkdown !== undefined
          ? { renderMarkdown: props.renderPlanMarkdown }
          : {})}
      />
      <ComposerInput
        collapsed={collapsed}
        {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
        {...(props.composer ?? {})}
        isSubmitting={isSubmitting}
        queueLength={queueLength}
      />
    </div>
  );
}
