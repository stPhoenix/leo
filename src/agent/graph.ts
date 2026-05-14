import type { Logger } from '@/platform/Logger';
import type {
  AnthropicThinkingConfig,
  ChatMessage,
  OpenAITool,
  ProviderChatRequest,
  ProviderHints,
  StreamEvent as ProviderStreamEvent,
  ToolCallRequest,
} from '@/providers/types';
import { chatContentText } from '@/providers/types';
import type { ToolRegistry } from '@/tools/toolRegistry';
import type { EditNoteBridge } from '@/tools/types';
import type { ReadFileStateStore } from '@/tools/builtin/readFileState';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WorkspaceNavigator } from '@/editor/workspaceNavigator';
import type { CanvasNavigator } from '@/editor/canvasNavigator';
import type { FocusedContext } from '@/editor/types';
import type { ContextModifier } from '@/skills/types';
import type { RagMode } from '@/settings/settingsStore';
import { Annotation, StateGraph, START, END, interrupt, MemorySaver } from '@langchain/langgraph';
import type { PlanModeController } from './planModeController';
import type { ToolSearchSession } from './toolSearch/toolSearchSession';
import type { ToolSearchInvocationResult } from '@/tools/toolSearch/types';
import { TOOL_SEARCH_TOOL_ID } from '@/tools/toolSearch/toolSearchTool';
import { buildToolSearchToolMessageContent } from './toolSearch/toolResultMapper';
import { assembleContext, renderPrompt } from './contextAssembler';
import { truncate, type TruncationResult } from './truncator';
import {
  isMicrocompactBoundary,
  microcompactMessages,
  type CompactAssistantMessage,
  type CompactMessage,
  type CompactToolCallRef,
  type CompactToolMessage,
} from './microcompact';
import {
  autoCompactIfNeeded,
  buildPostCompactMessages,
  shouldAutoCompactExact,
  type AutocompactProvider,
  type CompactionResult,
  type InvokedSkill,
  type PlanModeSource,
  type PlanSource,
  type RecentFileSource,
} from './autocompact';
import {
  shouldSkipForCircuitBreaker,
  type AutoCompactTrackingState,
  type BreakerStatusChannel,
} from './autocompactBreaker';
import type { CompactPhaseSink } from './compact/phaseSink';
import {
  type AgentAssistantMessage,
  type AgentHistoryMessage,
  type AgentUserMessage,
  type RagHit,
  type SkillListingSegment,
  type ThreadId,
} from './types';
import type { StreamEvent } from './streamEvents';
import { isSkillInvocationEnvelope } from '@/tools/builtin/skillTool';
import { extractMcpUiResources, type McpUiResource } from '@/mcp/mcpUiTypes';
import type { McpUiContent, TextBlock as ChatTextBlock, ToolResultContent } from '@/chat/types';

// Push/pull async-iterable bridge. `node:stream` (`PassThrough`) is unavailable in the
// Obsidian renderer (no Node built-ins). LangGraph `.streamEvents()` covers most pipes,
// but the auto-compact + interrupt re-entry path needs out-of-band pushes from outside
// the graph driver — this channel is the merge point.
export class EventChannel<T> {
  private readonly pending: T[] = [];
  private readonly resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private _closed = false;

  get closed(): boolean {
    return this._closed;
  }

  push(value: T): void {
    if (this._closed) return;
    const next = this.resolvers.shift();
    if (next !== undefined) {
      next({ value, done: false });
    } else {
      this.pending.push(value);
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    while (this.resolvers.length > 0) {
      const r = this.resolvers.shift()!;
      r({ value: undefined as unknown as T, done: true });
    }
  }

  iterable(): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<T> => ({
        next: (): Promise<IteratorResult<T>> => {
          if (this.pending.length > 0) {
            return Promise.resolve({ value: this.pending.shift()!, done: false });
          }
          if (this._closed) {
            return Promise.resolve({ value: undefined as unknown as T, done: true });
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            this.resolvers.push(resolve);
          });
        },
      }),
    };
  }
}

export interface GraphProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

export interface GraphRagHitsProvider {
  query(message: AgentUserMessage, focus: FocusedContext): Promise<readonly RagHit[]>;
}

export interface GraphRagEngineHit {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly score: number;
}

export interface GraphRagEngineLike {
  query(
    text: string,
    opts: { readonly tags?: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<readonly GraphRagEngineHit[]>;
}

export interface GraphSkillListingProvider {
  buildFor(args: {
    readonly thread: ThreadId;
    readonly agentId: string | null;
  }): SkillListingSegment | null;
}

export interface GraphMicrocompactOptions {
  readonly enabled: boolean;
  readonly gapThresholdMinutes: number | undefined;
  readonly keepRecent: number | undefined;
  readonly isCompactable: (toolName: string) => boolean;
}

export interface GraphAutocompactOptions {
  readonly enabled: boolean;
  readonly provider: AutocompactProvider;
  readonly tracking: AutoCompactTrackingState;
  readonly providerMaxInputTokens?: number;
  readonly userOverride?: () => number | undefined;
  readonly maxOutputTokensForModel?: number;
  readonly recentFiles?: RecentFileSource;
  readonly invokedSkills?: () => readonly InvokedSkill[];
  readonly plan?: PlanSource;
  readonly planMode?: PlanModeSource;
  readonly breakerNotifications?: BreakerStatusChannel;
  readonly onResult?: (result: CompactionResult) => void;
  readonly replaceHistory?: (thread: ThreadId, result: CompactionResult) => void;
  /**
   * Lazy widget hook — invoked only when an autocompact run is actually about
   * to start (or when the circuit breaker has tripped and we want to surface
   * the failure as a chat block). Returns the sink that drives the live
   * widget's phase transitions.
   */
  readonly beginRun?: (input: { trigger: 'auto'; threadId: ThreadId }) => CompactPhaseSink;
  readonly exactCounter?: (
    messages: readonly ChatMessage[],
    signal?: AbortSignal,
  ) => Promise<number>;
}

export type ConfirmationDecision = 'allow-once' | 'allow-thread' | 'deny';

export interface ToolConfirmationInterruptPayload {
  readonly kind: 'tool_confirmation';
  readonly toolId: string;
  readonly thread: ThreadId;
  readonly argsJson: string;
  readonly category: 'read' | 'write';
}

export interface GraphDeps {
  readonly provider: GraphProvider;
  readonly logger: Logger;
  readonly model: () => string;
  readonly skillListing: GraphSkillListingProvider | null;
  readonly rag: GraphRagHitsProvider;
  readonly ragEngine: GraphRagEngineLike | null;
  readonly ragMode: () => RagMode;
  readonly budget: number;
  readonly clock: () => Date;
  readonly toolRegistry: ToolRegistry | null;
  readonly vault: VaultAdapter;
  readonly editor: EditNoteBridge;
  readonly navigator?: WorkspaceNavigator;
  readonly canvasNavigator?: CanvasNavigator;
  readonly readState?: ReadFileStateStore;
  readonly excludeMatcher?: (path: string) => boolean;
  readonly maxToolRoundTrips: number;
  readonly allowedToolsForThread?: (thread: ThreadId) => ReadonlySet<string>;
  readonly markThreadAllowed?: (thread: ThreadId, toolId: string) => void;
  readonly planMode: PlanModeController | null;
  readonly agentIdFor: (thread: ThreadId) => string | null;
  readonly microcompact: GraphMicrocompactOptions;
  readonly autocompact?: GraphAutocompactOptions | null;
  readonly getHistory: (thread: ThreadId) => readonly AgentHistoryMessage[];
  readonly appendHistory: (thread: ThreadId, msg: AgentHistoryMessage) => void;
  readonly toolSearch?: ToolSearchSession;
  readonly disableParallelToolCalls?: () => boolean;
  readonly anthropicThinking?: () => AnthropicThinkingConfig | undefined;
  readonly maxTokens?: () => number;
}

export interface GraphTraceContext {
  readonly callbacks?: readonly unknown[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly tags: readonly string[];
}

export interface TurnBinding {
  readonly thread: ThreadId;
  readonly message: AgentUserMessage;
  readonly focus: FocusedContext;
  readonly enqueuedAt: string;
  readonly signal: AbortSignal;
  readonly events: EventChannel<StreamEvent>;
  readonly agentId: string | null;
  readonly traceContext?: GraphTraceContext;
}

export const AgentStateAnnotation = Annotation.Root({
  workingMessages: Annotation<ChatMessage[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  workingTimestamps: Annotation<number[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  allToolSpecs: Annotation<readonly OpenAITool[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  assistantText: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => '',
  }),
  iterationAssistantText: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => '',
  }),
  pendingToolCalls: Annotation<ToolCallRequest[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  roundTrip: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  effectiveModel: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => '',
  }),
  toolAllowlist: Annotation<ReadonlySet<string> | null>({
    reducer: (_p, n) => n,
    default: (): ReadonlySet<string> | null => null,
  }),
  turnHadToolCall: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
  turnCalledTodoWrite: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
  cancelled: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
  errored: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
  /**
   * Running offset added to every block_* index forwarded to the UI channel,
   * so successive callModel iterations within the same turn write to fresh
   * indices instead of overwriting earlier blocks (e.g. tool_use from
   * iteration 1 vs final text from iteration 2).
   */
  blockIndexOffset: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function deriveCategory(spec: { readonly id: string }): 'read' | 'write' {
  const id = spec.id;
  if (id.startsWith('read_') || id === 'search_vault') return 'read';
  return 'write';
}

function toCompactMessages(
  messages: readonly ChatMessage[],
  timestamps: readonly number[],
): CompactMessage[] {
  const out: CompactMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    out.push(toCompactMessage(messages[i]!, timestamps[i]));
  }
  return out;
}

function toCompactMessage(m: ChatMessage, ts: number | undefined): CompactMessage {
  const text = chatContentText(m.content);
  const tsField = ts !== undefined ? { timestamp: ts } : {};
  if (m.role === 'assistant') {
    const calls = m.toolCalls ?? [];
    const toolCalls: CompactToolCallRef[] = calls.map((c) => ({
      id: c.id,
      name: c.name,
      argsJson: c.argsJson,
    }));
    const assistant: CompactAssistantMessage = {
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...tsField,
    };
    return assistant;
  }
  if (m.role === 'tool') {
    const tool: CompactToolMessage = {
      role: 'tool',
      toolCallId: m.toolCallId ?? '',
      toolName: m.name ?? '',
      content: text,
      ...tsField,
    };
    return tool;
  }
  if (m.role === 'user') return { role: 'user', content: text, ...tsField };
  return { role: 'system', content: text, ...tsField };
}

function fromCompactMessages(messages: readonly CompactMessage[]): {
  messages: ChatMessage[];
  timestamps: number[];
} {
  const outMessages: ChatMessage[] = [];
  const outTimestamps: number[] = [];
  for (const m of messages) {
    if (isMicrocompactBoundary(m)) continue;
    const ts = typeof m.timestamp === 'number' ? m.timestamp : Date.now();
    if (m.role === 'assistant') {
      const chat: ChatMessage = {
        role: 'assistant',
        content: stringifyContent(m.content),
        ...(m.toolCalls !== undefined && m.toolCalls.length > 0
          ? {
              toolCalls: m.toolCalls.map((c) => ({
                id: c.id,
                name: c.name,
                argsJson: c.argsJson ?? '',
              })),
            }
          : {}),
      };
      outMessages.push(chat);
      outTimestamps.push(ts);
      continue;
    }
    if (m.role === 'tool') {
      outMessages.push({
        role: 'tool',
        toolCallId: m.toolCallId,
        name: m.toolName,
        content: stringifyContent(m.content),
      });
      outTimestamps.push(ts);
      continue;
    }
    if (m.role === 'user') {
      outMessages.push({ role: 'user', content: stringifyContent(m.content) });
      outTimestamps.push(ts);
      continue;
    }
    outMessages.push({ role: 'system', content: m.content });
    outTimestamps.push(ts);
  }
  return { messages: outMessages, timestamps: outTimestamps };
}

function stringifyContent(
  content: string | readonly { readonly type: string; readonly [k: string]: unknown }[],
): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'thinking' && typeof block.thinking === 'string')
      parts.push(block.thinking);
  }
  return parts.join('');
}

export class GraphBuilder {
  constructor(private readonly deps: GraphDeps) {}

  build(turn: TurnBinding): ReturnType<typeof buildAgentGraph> {
    return buildAgentGraph(this.deps, turn);
  }
}

function buildAutocompactGateOpts(
  state: AgentState,
  ac: GraphAutocompactOptions,
  deps: GraphDeps,
  turn: TurnBinding,
  userOverride: number | undefined,
): Parameters<typeof shouldAutoCompactExact>[0] {
  return {
    messages: state.workingMessages,
    model: state.effectiveModel,
    logger: deps.logger,
    signal: turn.signal,
    ...(ac.providerMaxInputTokens !== undefined
      ? { providerMaxInputTokens: ac.providerMaxInputTokens }
      : {}),
    ...(userOverride !== undefined ? { userOverride } : {}),
    ...(ac.maxOutputTokensForModel !== undefined
      ? { maxOutputTokensForModel: ac.maxOutputTokensForModel }
      : {}),
    ...(ac.exactCounter !== undefined ? { exactCounter: ac.exactCounter } : {}),
  };
}

function buildAutocompactRunOpts(
  state: AgentState,
  ac: GraphAutocompactOptions,
  deps: GraphDeps,
  turn: TurnBinding,
  userOverride: number | undefined,
  phaseSink: CompactPhaseSink | undefined,
): Parameters<typeof autoCompactIfNeeded>[1] {
  return {
    logger: deps.logger,
    provider: ac.provider,
    model: state.effectiveModel,
    querySource: 'agent_loop',
    trigger: 'auto',
    signal: turn.signal,
    tracking: ac.tracking,
    ...(ac.providerMaxInputTokens !== undefined
      ? { providerMaxInputTokens: ac.providerMaxInputTokens }
      : {}),
    ...(userOverride !== undefined ? { userOverride } : {}),
    ...(ac.maxOutputTokensForModel !== undefined
      ? { maxOutputTokensForModel: ac.maxOutputTokensForModel }
      : {}),
    ...(ac.breakerNotifications !== undefined
      ? { breakerNotifications: ac.breakerNotifications }
      : {}),
    ...(ac.recentFiles !== undefined ? { recentFiles: ac.recentFiles } : {}),
    ...(ac.invokedSkills !== undefined ? { invokedSkills: ac.invokedSkills() } : {}),
    ...(ac.plan !== undefined ? { plan: ac.plan } : {}),
    ...(ac.planMode !== undefined ? { planMode: ac.planMode } : {}),
    ...(phaseSink !== undefined ? { phaseSink } : {}),
    ...(ac.exactCounter !== undefined ? { exactCounter: ac.exactCounter } : {}),
  };
}

async function runAutocompactStep(
  state: AgentState,
  ac: GraphAutocompactOptions,
  deps: GraphDeps,
  turn: TurnBinding,
  userOverride: number | undefined,
  phaseSink: CompactPhaseSink | undefined,
): Promise<CompactionResult | null> {
  try {
    return await autoCompactIfNeeded(
      state.workingMessages,
      buildAutocompactRunOpts(state, ac, deps, turn, userOverride, phaseSink),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn('agent.autocompact.error', { thread: turn.thread, error: message });
    phaseSink?.error('unknown', message);
    return null;
  }
}

async function executeRagQuery(deps: GraphDeps, turn: TurnBinding): Promise<readonly RagHit[]> {
  if (deps.ragEngine !== null) {
    const engineHits = await deps.ragEngine.query(turn.message.content, {
      signal: turn.signal,
    });
    return engineHits.map(
      (h): RagHit => ({
        path: h.path,
        score: h.score,
        line_start: h.line_start,
        line_end: h.line_end,
      }),
    );
  }
  return await deps.rag.query(turn.message, turn.focus);
}

async function runRagPhase(deps: GraphDeps, turn: TurnBinding): Promise<readonly RagHit[]> {
  const thread = turn.thread;
  const mode = deps.ragMode();
  const shouldRunRag = mode === 'auto' || (mode === 'no-focus' && turn.focus.file === null);
  if (!shouldRunRag) {
    deps.logger.debug('agent.turn.rag.skip', { thread, mode, focusFile: turn.focus.file });
    return [];
  }
  const ragStart = nowMs();
  let ragHits: readonly RagHit[] = [];
  try {
    ragHits = await executeRagQuery(deps, turn);
  } catch (err) {
    deps.logger.warn('agent.rag.failure', {
      thread,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  deps.logger.debug('agent.turn.rag.ms', { thread, ms: Math.round(nowMs() - ragStart) });
  deps.logger.debug('agent.turn.rag.hits', { thread, hits: ragHits.length });
  return ragHits;
}

export function buildAgentGraph(deps: GraphDeps, turn: TurnBinding) {
  const prepareContext = async (_state: AgentState): Promise<Partial<AgentState>> => {
    const thread = turn.thread;
    const history = deps.getHistory(thread);
    const historyWithUser: readonly AgentHistoryMessage[] = [...history, turn.message];
    const ragHits = await runRagPhase(deps, turn);
    const agentId = turn.agentId;
    const skillListing = deps.skillListing?.buildFor({ thread, agentId }) ?? null;
    const prompt = assembleContext({
      focus: turn.focus,
      ragHits,
      history: historyWithUser,
      skillListing,
    });
    const truncation: TruncationResult = truncate(prompt.segments, deps.budget);
    if (truncation.dropped.history > 0 || truncation.dropped.ragHits > 0) {
      deps.logger.info('agent.turn.truncate', {
        thread,
        tokensBefore: truncation.tokensBefore,
        tokensAfter: truncation.tokensAfter,
        budget: truncation.budget,
        droppedHistory: truncation.dropped.history,
        droppedRagHits: truncation.dropped.ragHits,
      });
    }
    const baseMessages: ChatMessage[] = renderPrompt({
      segments: truncation.segments,
      focus: turn.focus,
    });
    if (deps.planMode !== null) {
      const attachments = deps.planMode.drainAttachments(thread);
      for (const reminder of attachments) {
        baseMessages.push({ role: 'system', content: reminder.body });
      }
      const staleReminder = deps.planMode.maybeInjectStaleTodoReminder(thread, agentId);
      if (staleReminder !== null) {
        baseMessages.push({ role: 'system', content: staleReminder });
      }
    }
    const planModeForList = deps.planMode !== null ? deps.planMode.getMode(thread) : undefined;
    const toolListOpts = planModeForList !== undefined ? { planMode: planModeForList } : {};
    const allToolSpecs: readonly OpenAITool[] =
      deps.toolRegistry !== null ? deps.toolRegistry.toOpenAITools(thread, toolListOpts) : [];
    const effectiveModel = deps.model();
    deps.logger.info('agent.turn.start', {
      thread,
      model: effectiveModel,
      messages: baseMessages.length,
      tools: allToolSpecs.length,
      focusFile: turn.focus.file,
      enqueuedAt: turn.enqueuedAt,
    });
    const workingMessages: ChatMessage[] = [...baseMessages];
    const workingTimestamps: number[] = baseMessages.map(() => deps.clock().getTime());
    const initialAllowedTools = turn.message.initialAllowedTools;
    const initialToolAllowlist: ReadonlySet<string> | null =
      initialAllowedTools !== undefined && initialAllowedTools.length > 0
        ? new Set(initialAllowedTools)
        : null;
    return {
      workingMessages,
      workingTimestamps,
      allToolSpecs,
      effectiveModel,
      assistantText: '',
      iterationAssistantText: '',
      pendingToolCalls: [],
      toolAllowlist: initialToolAllowlist,
      roundTrip: 0,
      turnHadToolCall: false,
      turnCalledTodoWrite: false,
      blockIndexOffset: 0,
      cancelled: false,
      errored: false,
    };
  };

  const applyAutocompactNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (turn.signal.aborted) return { cancelled: true };
    const ac = deps.autocompact ?? null;
    if (!ac?.enabled) return {};
    if (state.workingMessages.length === 0) return {};
    const userOverride = ac.userOverride?.();
    const breakerTripped = ac.tracking !== undefined && shouldSkipForCircuitBreaker(ac.tracking);
    const willRun = await shouldAutoCompactExact(
      buildAutocompactGateOpts(state, ac, deps, turn, userOverride),
    );
    if (!willRun && !breakerTripped) return {};
    const phaseSink = ac.beginRun?.({ trigger: 'auto', threadId: turn.thread });
    const result = await runAutocompactStep(state, ac, deps, turn, userOverride, phaseSink);
    if (result === null) return {};
    ac.onResult?.(result);
    ac.replaceHistory?.(turn.thread, result);
    const replaced = buildPostCompactMessages(result);
    const now = deps.clock().getTime();
    return {
      workingMessages: replaced,
      workingTimestamps: replaced.map(() => now),
    };
  };

  const applyMicrocompactNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (turn.signal.aborted) return { cancelled: true };
    if (!deps.microcompact.enabled) return {};
    if (state.workingMessages.length === 0) return {};
    const compactIn = toCompactMessages(state.workingMessages, state.workingTimestamps);
    const now = deps.clock().getTime();
    const res = microcompactMessages(compactIn, {
      now,
      ...(deps.microcompact.gapThresholdMinutes !== undefined
        ? { gapThresholdMinutes: deps.microcompact.gapThresholdMinutes }
        : {}),
      ...(deps.microcompact.keepRecent !== undefined
        ? { keepRecent: deps.microcompact.keepRecent }
        : {}),
      isCompactable: deps.microcompact.isCompactable,
      logger: { info: (event, fields): void => deps.logger.info(event, fields) },
    });
    if (res === null) return {};
    const rebuilt = fromCompactMessages(res.messages);
    return {
      workingMessages: rebuilt.messages,
      workingTimestamps: rebuilt.timestamps,
    };
  };

  const buildActiveTools = (
    state: AgentState,
  ): {
    tools: readonly OpenAITool[];
    providerHints: ProviderHints | undefined;
    announcement: string | null;
  } => {
    if (deps.toolSearch === undefined || deps.toolRegistry === null) {
      const tools =
        state.toolAllowlist === null
          ? state.allToolSpecs
          : state.allToolSpecs.filter((t) => state.toolAllowlist!.has(t.function.name));
      return { tools, providerHints: undefined, announcement: null };
    }
    const planModeForList = deps.planMode !== null ? deps.planMode.getMode(turn.thread) : undefined;
    const listOpts: { allowedTools?: ReadonlySet<string>; planMode?: 'normal' | 'plan' } = {
      ...(state.toolAllowlist !== null ? { allowedTools: state.toolAllowlist } : {}),
      ...(planModeForList !== undefined ? { planMode: planModeForList } : {}),
    };
    const assembled = deps.toolSearch.assemble({
      thread: turn.thread,
      registry: deps.toolRegistry,
      listOptions: listOpts,
      historyMessages: state.workingMessages.flatMap((m) =>
        typeof m.content === 'string' ? [] : [{ blocks: m.content }],
      ),
      modelId: state.effectiveModel,
    });
    return {
      tools: assembled.tools,
      providerHints: assembled.providerHints,
      announcement: assembled.announcement,
    };
  };

  const buildMergedHints = (
    providerHints: ProviderHints | undefined,
  ): ProviderHints | undefined => {
    const disableParallel = deps.disableParallelToolCalls?.() === true;
    const thinking = deps.anthropicThinking?.();
    if (!disableParallel && thinking === undefined && providerHints === undefined) return undefined;
    return {
      ...(providerHints ?? {}),
      ...(disableParallel ? { disableParallelToolCalls: true } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
    };
  };

  const buildProviderRequest = (
    state: AgentState,
    turnMessages: readonly ChatMessage[],
    activeTools: readonly OpenAITool[],
    mergedHints: ProviderHints | undefined,
  ): ProviderChatRequest => {
    const traceCtx = turn.traceContext;
    const maxTokens = deps.maxTokens?.();
    return {
      model: state.effectiveModel,
      messages: [...turnMessages],
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(activeTools.length > 0 ? { tools: activeTools } : {}),
      ...(mergedHints !== undefined ? { providerHints: mergedHints } : {}),
      ...(traceCtx !== undefined
        ? {
            trace: {
              ...(traceCtx.callbacks !== undefined ? { callbacks: traceCtx.callbacks } : {}),
              metadata: traceCtx.metadata,
              tags: [...traceCtx.tags],
            },
          }
        : {}),
    };
  };

  interface StreamAccumulator {
    iterationAssistant: string;
    maxIndexInIteration: number;
    readonly toolBufs: Map<number, { id: string; name: string; args: string }>;
    readonly pendingToolCalls: ToolCallRequest[];
  }

  const applyBlockStart = (
    ev: Extract<ProviderStreamEvent, { type: 'block_start' }>,
    accum: StreamAccumulator,
  ): void => {
    if (ev.block.type === 'tool_use') {
      accum.toolBufs.set(ev.index, { id: ev.block.id, name: ev.block.name, args: '' });
    }
  };

  const applyBlockDelta = (
    ev: Extract<ProviderStreamEvent, { type: 'block_delta' }>,
    accum: StreamAccumulator,
  ): void => {
    if (ev.delta.type === 'text_delta') {
      accum.iterationAssistant += ev.delta.text;
    } else if (ev.delta.type === 'input_json_delta') {
      const buf = accum.toolBufs.get(ev.index);
      if (buf !== undefined) buf.args += ev.delta.partial_json;
    }
  };

  const applyBlockStop = (
    ev: Extract<ProviderStreamEvent, { type: 'block_stop' }>,
    accum: StreamAccumulator,
  ): void => {
    const buf = accum.toolBufs.get(ev.index);
    if (buf !== undefined) {
      accum.pendingToolCalls.push({
        id: buf.id,
        name: buf.name,
        argsJson: buf.args.length === 0 ? '{}' : buf.args,
      });
      accum.toolBufs.delete(ev.index);
    }
  };

  // Returns 'continue' to keep streaming, 'break' to stop normally, or 'errored'
  // to abort the turn after an error event. The accumulator is mutated in place.
  const applyStreamEvent = (
    ev: ProviderStreamEvent,
    accum: StreamAccumulator,
    offset: number,
  ): 'continue' | 'break' | 'errored' => {
    if (ev.type === 'block_start') applyBlockStart(ev, accum);
    else if (ev.type === 'block_delta') applyBlockDelta(ev, accum);
    else if (ev.type === 'block_stop') applyBlockStop(ev, accum);
    else if (ev.type === 'message_delta' || ev.type === 'progress') {
      turn.events.push(ev);
      return 'continue';
    } else if (ev.type === 'error') {
      reportTurnError(ev.error);
      return 'errored';
    } else if (ev.type === 'done') return 'break';
    else return 'continue';

    if (ev.index > accum.maxIndexInIteration) accum.maxIndexInIteration = ev.index;
    turn.events.push({ ...ev, index: ev.index + offset });
    return 'continue';
  };

  const reportTurnError = (error: Error): void => {
    turn.events.push({ type: 'error', error });
    deps.logger.error('agent.turn.done', {
      thread: turn.thread,
      cancelled: false,
      errored: true,
      error: error.message,
    });
    turn.events.close();
  };

  const consumeProviderStream = async (
    req: ReturnType<typeof buildProviderRequest>,
    accum: StreamAccumulator,
    offset: number,
  ): Promise<'ok' | 'errored' | 'cancelled'> => {
    try {
      for await (const ev of deps.provider.stream(req, turn.signal)) {
        if (turn.signal.aborted) break;
        const outcome = applyStreamEvent(ev, accum, offset);
        if (outcome === 'errored') return 'errored';
        if (outcome === 'break') break;
      }
      return 'ok';
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (turn.signal.aborted) return 'cancelled';
      reportTurnError(error);
      return 'errored';
    }
  };

  const callModelNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    if (turn.signal.aborted) return { cancelled: true };
    const { tools: activeTools, providerHints, announcement } = buildActiveTools(state);
    const turnMessages: ChatMessage[] =
      announcement !== null
        ? [...state.workingMessages, { role: 'system', content: announcement }]
        : state.workingMessages;
    const mergedHints = buildMergedHints(providerHints);
    const req = buildProviderRequest(state, turnMessages, activeTools, mergedHints);

    const accum: StreamAccumulator = {
      iterationAssistant: '',
      maxIndexInIteration: -1,
      toolBufs: new Map(),
      pendingToolCalls: [],
    };
    const offset = state.blockIndexOffset;
    const status = await consumeProviderStream(req, accum, offset);
    if (status === 'cancelled') return { cancelled: true };
    if (status === 'errored') return { errored: true };

    const turnCalledTodoWrite =
      state.turnCalledTodoWrite || accum.pendingToolCalls.some((c) => c.name === 'TodoWrite');
    const nextOffset =
      accum.maxIndexInIteration >= 0 ? offset + accum.maxIndexInIteration + 1 : offset;
    return {
      assistantText: state.assistantText + accum.iterationAssistant,
      iterationAssistantText: accum.iterationAssistant,
      pendingToolCalls: accum.pendingToolCalls,
      turnHadToolCall: state.turnHadToolCall || accum.pendingToolCalls.length > 0,
      turnCalledTodoWrite,
      blockIndexOffset: nextOffset,
    };
  };

  type CallOutcome =
    | { kind: 'plan-blocked' }
    | { kind: 'unknown-tool' }
    | { kind: 'no-registry' }
    | { kind: 'allow-no-confirm' }
    | { kind: 'allow-allowlisted' }
    | { kind: 'allow-once' }
    | { kind: 'allow-thread' }
    | { kind: 'deny' };

  const classifyCall = (call: ToolCallRequest, thread: ThreadId): CallOutcome => {
    if (
      deps.planMode !== null &&
      deps.planMode.getMode(thread) === 'plan' &&
      !deps.planMode.isToolAllowedInPlan(call.name)
    ) {
      return { kind: 'plan-blocked' };
    }
    if (deps.toolRegistry === null) return { kind: 'no-registry' };
    const spec = deps.toolRegistry.lookup(call.name);
    if (spec === undefined) return { kind: 'unknown-tool' };
    if (!spec.requiresConfirmation) return { kind: 'allow-no-confirm' };
    const allowed =
      deps.allowedToolsForThread !== undefined ? deps.allowedToolsForThread(thread) : null;
    if (allowed?.has(call.name) === true) return { kind: 'allow-allowlisted' };
    const payload: ToolConfirmationInterruptPayload = {
      kind: 'tool_confirmation',
      toolId: call.name,
      thread,
      argsJson: call.argsJson,
      category: deriveCategory(spec),
    };
    const decision = interrupt<ToolConfirmationInterruptPayload, ConfirmationDecision>(payload);
    if (decision === 'deny') return { kind: 'deny' };
    if (decision === 'allow-thread') return { kind: 'allow-thread' };
    return { kind: 'allow-once' };
  };

  type ToolInvocationResult = { ok: true; data: unknown } | { ok: false; error: string };

  const executeOutcome = async (
    call: ToolCallRequest,
    outcome: CallOutcome,
    thread: ThreadId,
    agentId: string | null,
  ): Promise<ToolInvocationResult> => {
    if (outcome.kind === 'plan-blocked') {
      deps.planMode?.recordToolBlocked(thread, call.name);
      return { ok: false, error: `blocked by plan mode: ${call.name}` };
    }
    if (outcome.kind === 'no-registry')
      return { ok: false, error: `no tool registry for ${call.name}` };
    if (outcome.kind === 'unknown-tool') return { ok: false, error: `unknown tool: ${call.name}` };
    if (outcome.kind === 'deny') {
      deps.logger.info('tool.confirmation.deny', { toolId: call.name, thread, decision: 'deny' });
      return { ok: false, error: `user denied ${call.name}` };
    }
    if (outcome.kind === 'allow-thread') {
      deps.logger.info('tool.confirmation.allow-thread', {
        toolId: call.name,
        thread,
        decision: 'allow-thread',
      });
      deps.markThreadAllowed?.(thread, call.name);
    } else if (outcome.kind === 'allow-once') {
      deps.logger.info('tool.confirmation.allow-once', {
        toolId: call.name,
        thread,
        decision: 'allow-once',
      });
    }
    return await deps.toolRegistry!.invoke(call.name, call.argsJson, {
      thread,
      signal: turn.signal,
      vault: deps.vault,
      editor: deps.editor,
      ...(deps.navigator !== undefined ? { navigator: deps.navigator } : {}),
      ...(deps.canvasNavigator !== undefined ? { canvasNavigator: deps.canvasNavigator } : {}),
      logger: deps.logger,
      agentId,
      ...(deps.readState !== undefined ? { readState: deps.readState } : {}),
      ...(deps.excludeMatcher !== undefined ? { excludeMatcher: deps.excludeMatcher } : {}),
    });
  };

  type SkillEnvelopeShape = {
    skillName: string;
    messages: readonly { role: string; content: string; marker?: string }[];
    contextModifier?: ContextModifier;
  };

  const buildToolResultContent = (
    result: ToolInvocationResult,
    call: ToolCallRequest,
    thread: ThreadId,
  ): {
    content: ToolResultContent;
    skillEnvelope: SkillEnvelopeShape | null;
    toolSearchWire: ReturnType<typeof buildToolSearchToolMessageContent> | null;
    mcpUi: { resources: readonly McpUiResource[]; uiContent: ToolResultContent } | null;
  } => {
    const skillEnvelope =
      result.ok && isSkillInvocationEnvelope(result.data)
        ? (result.data as unknown as SkillEnvelopeShape)
        : null;
    const toolSearchWire =
      result.ok && call.name === TOOL_SEARCH_TOOL_ID && deps.toolSearch !== undefined
        ? buildToolSearchToolMessageContent(
            result.data as ToolSearchInvocationResult,
            deps.toolSearch.snapshotFor(thread).nativeDeferral,
          )
        : null;
    const mcpExtract = result.ok ? extractMcpUiResources(result.data) : null;
    const serverId = parseMcpServerId(call.name);
    const mcpUi =
      mcpExtract !== null && mcpExtract.uiResources.length > 0
        ? buildMcpUiPayload(mcpExtract.textParts, mcpExtract.uiResources, serverId)
        : null;
    let content: ToolResultContent;
    if (toolSearchWire !== null) {
      content = toolSearchWire.content;
    } else if (skillEnvelope !== null) {
      content = JSON.stringify({
        ok: true,
        data: { skill: skillEnvelope.skillName, status: 'injected' },
      });
    } else if (mcpUi !== null) {
      content = JSON.stringify({
        ok: result.ok,
        ui: mcpUi.resources.map((r) => ({ uri: r.uri, mimeType: r.mimeType })),
        text: mcpExtract?.textParts.join('\n') ?? '',
      });
    } else {
      content = JSON.stringify(result);
    }
    return { content, skillEnvelope, toolSearchWire, mcpUi };
  };

  const buildMcpUiPayload = (
    textParts: readonly string[],
    resources: readonly McpUiResource[],
    serverId: string | undefined,
  ): { resources: readonly McpUiResource[]; uiContent: ToolResultContent } => {
    const items: (ChatTextBlock | McpUiContent)[] = [];
    const text = textParts.join('\n').trim();
    if (text.length > 0) items.push({ type: 'text', text });
    for (const r of resources) {
      items.push({
        type: 'mcp_ui',
        uri: r.uri,
        mimeType: r.mimeType,
        html: r.html,
        ...(serverId !== undefined ? { serverId } : {}),
      });
    }
    return { resources, uiContent: items };
  };

  const parseMcpServerId = (toolName: string): string | undefined => {
    if (!toolName.startsWith('mcp.')) return undefined;
    const rest = toolName.slice('mcp.'.length);
    const dot = rest.indexOf('.');
    if (dot <= 0) return undefined;
    return rest.slice(0, dot);
  };

  const applySkillEnvelope = (
    envelope: NonNullable<ReturnType<typeof buildToolResultContent>['skillEnvelope']>,
    workingMessages: ChatMessage[],
    workingTimestamps: number[],
    current: {
      toolAllowlist: AgentState['toolAllowlist'];
      effectiveModel: AgentState['effectiveModel'];
    },
  ): void => {
    for (const msg of envelope.messages) {
      workingMessages.push({
        role: msg.role === 'system' ? 'system' : 'user',
        content: msg.marker !== undefined ? `${msg.marker}\n${msg.content}` : msg.content,
      });
      workingTimestamps.push(deps.clock().getTime());
    }
    const mod = envelope.contextModifier;
    if (mod === undefined) return;
    if (mod.allowedTools !== undefined && mod.allowedTools.length > 0) {
      current.toolAllowlist = new Set(mod.allowedTools);
    }
    if (mod.model !== undefined) current.effectiveModel = mod.model;
  };

  const handleToolCallsNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const thread = turn.thread;
    const agentId = turn.agentId;
    // PASS 1 — pure reads + interrupts. Replays on each resume until every
    // interrupt resolved. No side effects.
    const outcomes: CallOutcome[] = state.pendingToolCalls.map((call) =>
      classifyCall(call, thread),
    );

    // PASS 2 — side effects. Runs exactly once, after every interrupt in PASS 1 has resolved.
    const workingMessages: ChatMessage[] = [...state.workingMessages];
    const workingTimestamps: number[] = [...state.workingTimestamps];
    let cancelled = state.cancelled;
    const ctx = { toolAllowlist: state.toolAllowlist, effectiveModel: state.effectiveModel };
    workingMessages.push({
      role: 'assistant',
      content: state.iterationAssistantText,
      toolCalls: state.pendingToolCalls,
    });
    workingTimestamps.push(deps.clock().getTime());

    let toolResultBlockCount = 0;
    for (let i = 0; i < state.pendingToolCalls.length; i += 1) {
      const call = state.pendingToolCalls[i]!;
      const outcome = outcomes[i]!;
      if (turn.signal.aborted) {
        cancelled = true;
        break;
      }
      const result = await executeOutcome(call, outcome, thread, agentId);
      const { content, skillEnvelope, toolSearchWire, mcpUi } = buildToolResultContent(
        result,
        call,
        thread,
      );
      workingMessages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      workingTimestamps.push(deps.clock().getTime());
      if (toolSearchWire !== null && toolSearchWire.discoveredAdded.length > 0) {
        deps.toolSearch?.recordDiscovery(thread, toolSearchWire.discoveredAdded);
      }
      turn.events.push({ type: 'tool_result', id: call.id, result });
      const uiContent: ToolResultContent = mcpUi !== null ? mcpUi.uiContent : content;
      const blockIndex = state.blockIndexOffset + toolResultBlockCount;
      turn.events.push({
        type: 'block_start',
        index: blockIndex,
        block: {
          type: 'tool_result',
          tool_use_id: call.id,
          content: uiContent,
          ...(result.ok ? {} : { is_error: true }),
        },
      });
      turn.events.push({ type: 'block_stop', index: blockIndex });
      toolResultBlockCount += 1;
      if (mcpUi !== null) {
        deps.logger.info('mcp.ui.render', {
          thread,
          toolId: call.name,
          callId: call.id,
          uiCount: mcpUi.resources.length,
        });
      }
      if (skillEnvelope !== null) {
        applySkillEnvelope(skillEnvelope, workingMessages, workingTimestamps, ctx);
      }
    }
    if (!cancelled) cancelled = turn.signal.aborted;
    return {
      workingMessages,
      workingTimestamps,
      cancelled,
      toolAllowlist: ctx.toolAllowlist,
      effectiveModel: ctx.effectiveModel,
      pendingToolCalls: [],
      iterationAssistantText: '',
      roundTrip: state.roundTrip + 1,
      blockIndexOffset: state.blockIndexOffset + toolResultBlockCount,
    };
  };

  const finalizeNode = async (state: AgentState): Promise<Partial<AgentState>> => {
    const thread = turn.thread;
    let cancelled = state.cancelled;
    if (!cancelled) cancelled = turn.signal.aborted;
    if (deps.planMode !== null && !cancelled && !state.errored) {
      deps.planMode.recordAssistantTurn(thread, {
        hasToolCall: state.turnHadToolCall,
        calledTodoWrite: state.turnCalledTodoWrite,
      });
    }

    // If we exited because the tool round-trip cap was hit AND the model
    // never got a chance to produce text, the user otherwise sees an empty
    // bubble. Inject a synthetic assistant message naming the cap so the
    // termination is visible + actionable.
    let assistantText = state.assistantText;
    let injectedRoundTripNotice = false;
    if (
      !cancelled &&
      !state.errored &&
      state.assistantText.length === 0 &&
      state.roundTrip >= deps.maxToolRoundTrips
    ) {
      const notice =
        `[Tool round-trip limit reached (${deps.maxToolRoundTrips}). The agent stopped without writing a final answer. ` +
        `Raise Provider › Max tool round-trips in Settings, or send another message to continue.]`;
      const idx = state.blockIndexOffset;
      turn.events.push({ type: 'block_start', index: idx, block: { type: 'text' } });
      turn.events.push({
        type: 'block_delta',
        index: idx,
        delta: { type: 'text_delta', text: notice },
      });
      turn.events.push({ type: 'block_stop', index: idx });
      assistantText = notice;
      injectedRoundTripNotice = true;
      deps.logger.warn('agent.turn.maxRoundTrips', {
        thread,
        cap: deps.maxToolRoundTrips,
        roundTrip: state.roundTrip,
      });
    }

    const historyUser: AgentUserMessage = { role: 'user', content: turn.message.content };
    deps.appendHistory(thread, historyUser);
    if (!cancelled && !state.errored && assistantText.length > 0) {
      const assistant: AgentAssistantMessage = {
        role: 'assistant',
        content: assistantText,
      };
      deps.appendHistory(thread, assistant);
    }
    turn.events.push({ type: 'done', cancelled });
    turn.events.close();
    deps.logger.info('agent.turn.done', {
      thread,
      cancelled,
      errored: false,
      assistantChars: assistantText.length,
      ...(injectedRoundTripNotice ? { maxRoundTripsHit: true } : {}),
    });
    return { cancelled };
  };

  const routeAfterModel = (state: AgentState): 'handleToolCalls' | 'finalize' | typeof END => {
    if (state.errored) return END;
    if (turn.signal.aborted) return 'finalize';
    if (state.pendingToolCalls.length === 0) return 'finalize';
    return 'handleToolCalls';
  };

  const routeAfterTools = (state: AgentState): 'applyAutocompact' | 'finalize' => {
    if (state.cancelled) return 'finalize';
    if (state.errored) return 'finalize';
    if (state.roundTrip >= deps.maxToolRoundTrips) return 'finalize';
    return 'applyAutocompact';
  };

  const builder = new StateGraph(AgentStateAnnotation)
    .addNode('prepareContext', prepareContext)
    .addNode('applyAutocompact', applyAutocompactNode)
    .addNode('applyMicrocompact', applyMicrocompactNode)
    .addNode('callModel', callModelNode)
    .addNode('handleToolCalls', handleToolCallsNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'prepareContext')
    .addEdge('prepareContext', 'applyAutocompact')
    .addEdge('applyAutocompact', 'applyMicrocompact')
    .addEdge('applyMicrocompact', 'callModel')
    .addConditionalEdges('callModel', routeAfterModel, ['handleToolCalls', 'finalize', END])
    .addConditionalEdges('handleToolCalls', routeAfterTools, ['applyAutocompact', 'finalize'])
    .addEdge('finalize', END);

  const recursionLimit = Math.max(25, deps.maxToolRoundTrips * 4 + 10);
  const checkpointer = new MemorySaver();
  return builder.compile({ checkpointer }).withConfig({ recursionLimit });
}

export const USE_GRAPH_RUNTIME = true;
