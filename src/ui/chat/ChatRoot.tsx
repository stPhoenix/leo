import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
import {
  ClarifyingQuestionDialog,
  type ClarifyingQuestionSource,
} from './ClarifyingQuestionDialog';
import type { PlanModeSource } from './planModeSource';
import type { PlanMode } from '@/agent/planModeController';
import { ThreadSwitcher, type ThreadsUiSource } from './ThreadSwitcher';
import { TemperatureSliderLive } from './TemperatureSliderLive';
import type { TemperatureSource } from './temperatureSource';
import { IndexStatusBlock, type IndexStatusSource } from './IndexStatusBlock';
import type { DrainListener } from '@/indexer/vaultIndexer';
import { isCollapsed } from '../responsiveCollapse';
import type { ChatMessageStore } from '@/chat/messageStore';
import type { StreamingPhase } from '@/chat/streamingController';
import type { CodeBlockClipboard } from './codeBlockEnhancer';
import type { ToolUseBlockSlots } from './blocks';
import type { RunStateSource } from './blocks/toolUseStatus';
import { BottomLiveIndicator } from './BottomLiveIndicator';
import { McpUiContext, type McpUiContextValue } from './mcpUiContext';
import {
  useObsidianThemeVars,
  type UseObsidianThemeVarsOptions,
} from './hooks/useObsidianThemeVars';
import type { McpUiAction, McpUiActionResponse } from '@/mcp/mcpUiActions';

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
  readonly clarifyingQuestionSource?: ClarifyingQuestionSource;
  readonly planModeSource?: PlanModeSource;
  readonly headerStats?: ReactNode;
  readonly temperatureSource?: TemperatureSource;
  readonly threadsSource?: ThreadsUiSource;
  readonly indexStatusSource?: IndexStatusSource;
  readonly indexDrainSubscribe?: (listener: DrainListener) => () => void;
  readonly onReindexAll?: () => void;
  readonly onReindexChanged?: () => void;
  readonly toolUseSlots?: ToolUseBlockSlots;
  readonly liveIndicatorRunState?: RunStateSource;
  readonly lastEventAtSource?: () => number | null;
  readonly onCancelLive?: () => void;
  readonly resolveToolName?: (id: string) => string;
  readonly mcpUiDispatchAction?: (
    action: McpUiAction,
    serverId: string,
  ) => Promise<McpUiActionResponse>;
  readonly mcpUiThemeOptions?: UseObsidianThemeVarsOptions;
  readonly mcpUiOnError?: (err: Error) => void;
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
const STATIC_NORMAL_PLAN_MODE: PlanMode = 'normal';
const STATIC_NORMAL_PLAN_SOURCE: PlanModeSource = {
  getMode: () => STATIC_NORMAL_PLAN_MODE,
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
  const planModeSource = props.planModeSource ?? STATIC_NORMAL_PLAN_SOURCE;
  const planMode = useSyncExternalStore<PlanMode>(
    planModeSource.subscribe,
    planModeSource.getMode,
    planModeSource.getMode,
  );
  const planModeActive = planMode === 'plan';
  const isSubmitting = phase === 'streaming' || phase === 'cancelling';

  const themeSnapshot = useObsidianThemeVars(props.mcpUiThemeOptions ?? {});
  const mcpUiContextValue: McpUiContextValue | null =
    props.mcpUiDispatchAction !== undefined
      ? {
          theme: themeSnapshot,
          dispatchAction: props.mcpUiDispatchAction,
          ...(props.mcpUiOnError !== undefined ? { onError: props.mcpUiOnError } : {}),
        }
      : null;

  useEffect(() => {
    const observe = props.observeWidth;
    if (observe === undefined) return;
    const unsubscribe = observe((w) => setCollapsed(isCollapsed(w)));
    return () => unsubscribe();
  }, [props.observeWidth]);

  const tree = (
    <div
      ref={rootRef}
      className={`leo-chat-root${collapsed ? ' is-collapsed' : ''}${planModeActive ? ' is-plan-mode' : ''}`}
      data-region="root"
      {...(planModeActive ? { 'data-plan-mode': 'true' } : {})}
    >
      <HeaderBar
        collapsed={collapsed}
        onOverflowMenu={props.onOverflowMenu}
        planModeActive={planModeActive}
        {...(props.headerStats !== undefined ? { stats: props.headerStats } : {})}
        {...(props.temperatureSource !== undefined
          ? {
              temperature: (
                <TemperatureSliderLive
                  source={props.temperatureSource}
                  {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
                />
              ),
            }
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
      <IndexStatusBlock
        {...(props.indexStatusSource !== undefined ? { source: props.indexStatusSource } : {})}
        {...(props.indexDrainSubscribe !== undefined
          ? { drainSubscribe: props.indexDrainSubscribe }
          : {})}
        {...(props.onReindexAll !== undefined ? { onReindexAll: props.onReindexAll } : {})}
        {...(props.onReindexChanged !== undefined
          ? { onReindexChanged: props.onReindexChanged }
          : {})}
      />
      <MessageList
        store={props.messageStore}
        renderMarkdown={props.renderMarkdown}
        clipboard={props.clipboard}
        {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
        {...(props.messageActions !== undefined ? { actions: props.messageActions } : {})}
        {...(props.toolUseSlots !== undefined ? { toolUseSlots: props.toolUseSlots } : {})}
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
      <ClarifyingQuestionDialog
        {...(props.clarifyingQuestionSource !== undefined
          ? { source: props.clarifyingQuestionSource }
          : {})}
      />
      <BottomLiveIndicator
        messageStore={props.messageStore}
        phaseSource={phaseSource}
        {...(props.liveIndicatorRunState !== undefined
          ? { runState: props.liveIndicatorRunState }
          : {})}
        {...(props.lastEventAtSource !== undefined
          ? { lastEventAtSource: props.lastEventAtSource }
          : {})}
        {...(props.onCancelLive !== undefined ? { onCancel: props.onCancelLive } : {})}
        {...(props.resolveToolName !== undefined ? { resolveToolName: props.resolveToolName } : {})}
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
  if (mcpUiContextValue === null) return tree;
  return <McpUiContext.Provider value={mcpUiContextValue}>{tree}</McpUiContext.Provider>;
}
