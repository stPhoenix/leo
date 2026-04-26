import type { Logger } from '@/platform/Logger';
import type { FocusedContext } from '@/editor/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type { ProviderChatRequest, StreamEvent as ProviderStreamEvent } from '@/providers/types';
import type { StreamEvent } from './streamEvents';
import type { ToolRegistry } from '@/tools/toolRegistry';
import type { EditNoteBridge } from '@/tools/types';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WorkspaceNavigator } from '@/editor/workspaceNavigator';
import type { PlanModeController } from './planModeController';
import { BUILTIN_COMPACTABLE_TOOLS } from './microcompact';
import {
  type AgentHistoryMessage,
  type AgentUserMessage,
  type RagHit,
  type SkillListingSegment,
  type ThreadId,
  type ToolConfirmationDecision,
  type TurnInput,
} from './types';
import { Command, INTERRUPT, isInterrupted } from '@langchain/langgraph';
import {
  buildAgentGraph,
  EventChannel,
  USE_GRAPH_RUNTIME,
  type ConfirmationDecision,
  type GraphAutocompactOptions,
  type GraphDeps,
  type GraphTraceContext,
  type ToolConfirmationInterruptPayload,
  type TurnBinding,
} from './graph';

export interface AgentTracer {
  beginTurn(input: {
    readonly sessionId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly tags: readonly string[];
    readonly name?: string;
  }): {
    readonly traceContext: GraphTraceContext;
    end(): Promise<void>;
  };
}

export interface AgentRunnerProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<ProviderStreamEvent>;
}

export interface FocusedContextSource {
  current(): FocusedContext;
}

export interface RagHitsProvider {
  query(message: AgentUserMessage, focus: FocusedContext): Promise<readonly RagHit[]>;
}

export interface RagEngineHit {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly score: number;
}

export interface RagEngineLike {
  query(
    text: string,
    opts: { readonly tags?: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<readonly RagEngineHit[]>;
}

export interface SkillListingProvider {
  buildFor(args: {
    readonly thread: ThreadId;
    readonly agentId: string | null;
  }): SkillListingSegment | null;
}

export interface AgentRunnerOptions {
  readonly provider: AgentRunnerProvider;
  readonly focusedContext: FocusedContextSource;
  readonly logger: Logger;
  readonly model: () => string;
  readonly skillListing?: SkillListingProvider;
  readonly rag?: RagHitsProvider;
  readonly ragEngine?: RagEngineLike;
  readonly budget?: number;
  readonly historyByThread?: Map<ThreadId, AgentHistoryMessage[]>;
  readonly clock?: () => Date;
  readonly toolRegistry?: ToolRegistry;
  readonly vault?: VaultAdapter;
  readonly editor?: EditNoteBridge;
  readonly navigator?: WorkspaceNavigator;
  readonly maxToolRoundTrips?: number;
  readonly allowedToolsForThread?: (thread: ThreadId) => ReadonlySet<string>;
  readonly markThreadAllowed?: (thread: ThreadId, toolId: string) => void;
  readonly planMode?: PlanModeController;
  readonly agentIdFor?: (thread: ThreadId) => string | null;
  readonly microcompact?: MicrocompactAgentOptions;
  readonly autocompact?: GraphAutocompactOptions | null;
  readonly tracer?: AgentTracer;
}

export interface MicrocompactAgentOptions {
  readonly enabled?: boolean;
  readonly gapThresholdMinutes?: number;
  readonly keepRecent?: number;
  readonly isCompactable?: (toolName: string) => boolean;
}

interface TurnSlot {
  readonly input: TurnInput;
  readonly focus: FocusedContext;
  readonly abort: AbortController;
  readonly events: EventChannel<StreamEvent>;
  readonly enqueuedAt: string;
  cancelledBeforeStart: boolean;
  started: boolean;
}

const DEFAULT_BUDGET_TOKENS = 16_000;
const DEFAULT_MAX_TOOL_ROUND_TRIPS = 8;

export { USE_GRAPH_RUNTIME };

export class AgentRunner {
  private readonly provider: AgentRunnerProvider;
  private readonly focus: FocusedContextSource;
  private readonly logger: Logger;
  private readonly model: () => string;
  private readonly skillListing: SkillListingProvider | null;
  private readonly rag: RagHitsProvider;
  private readonly ragEngine: RagEngineLike | null;
  private readonly budget: number;
  private readonly historyByThread: Map<ThreadId, AgentHistoryMessage[]>;
  private readonly clock: () => Date;
  private readonly toolRegistry: ToolRegistry | null;
  private readonly vault: VaultAdapter | null;
  private readonly editor: EditNoteBridge | null;
  private readonly navigator: WorkspaceNavigator | null;
  private readonly maxToolRoundTrips: number;
  private readonly allowedToolsForThread: AgentRunnerOptions['allowedToolsForThread'];
  private readonly markThreadAllowed: AgentRunnerOptions['markThreadAllowed'];
  private readonly planMode: PlanModeController | null;
  private readonly agentIdFor: (thread: ThreadId) => string | null;
  private readonly microcompactEnabled: boolean;
  private readonly microcompactGapMinutes: number | undefined;
  private readonly microcompactKeepRecent: number | undefined;
  private readonly microcompactIsCompactable: ((toolName: string) => boolean) | undefined;
  private readonly autocompactOptions: GraphAutocompactOptions | null;
  private readonly tracer: AgentTracer | undefined;
  private readonly slots: TurnSlot[] = [];
  private inflight: TurnSlot | null = null;
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(opts: AgentRunnerOptions) {
    this.provider = opts.provider;
    this.focus = opts.focusedContext;
    this.logger = opts.logger;
    this.model = opts.model;
    this.skillListing = opts.skillListing ?? null;
    this.rag = opts.rag ?? { query: async () => [] };
    this.ragEngine = opts.ragEngine ?? null;
    this.budget = opts.budget ?? DEFAULT_BUDGET_TOKENS;
    this.historyByThread = opts.historyByThread ?? new Map();
    this.clock = opts.clock ?? ((): Date => new Date());
    this.toolRegistry = opts.toolRegistry ?? null;
    this.vault = opts.vault ?? null;
    this.editor = opts.editor ?? null;
    this.navigator = opts.navigator ?? null;
    this.maxToolRoundTrips = opts.maxToolRoundTrips ?? DEFAULT_MAX_TOOL_ROUND_TRIPS;
    this.allowedToolsForThread = opts.allowedToolsForThread;
    this.markThreadAllowed = opts.markThreadAllowed;
    this.planMode = opts.planMode ?? null;
    this.agentIdFor = opts.agentIdFor ?? ((): string | null => null);
    const mc = opts.microcompact ?? {};
    this.microcompactEnabled = mc.enabled ?? true;
    this.microcompactGapMinutes = mc.gapThresholdMinutes;
    this.microcompactKeepRecent = mc.keepRecent;
    this.microcompactIsCompactable = mc.isCompactable;
    this.autocompactOptions = opts.autocompact ?? null;
    this.tracer = opts.tracer;
  }

  send(msg: AgentUserMessage, thread: ThreadId): AsyncIterable<StreamEvent> {
    const focus: FocusedContext = this.focus.current() ?? NULL_FOCUSED_CONTEXT;
    const abort = new AbortController();
    const events = new EventChannel<StreamEvent>();
    const slot: TurnSlot = {
      input: { thread, message: msg },
      focus,
      abort,
      events,
      enqueuedAt: this.clock().toISOString(),
      cancelledBeforeStart: false,
      started: false,
    };
    this.slots.push(slot);
    const prev = this.tail;
    this.tail = prev.catch(() => undefined).then(() => this.runSlot(slot));
    return events.iterable();
  }

  cancel(thread: ThreadId): void {
    this.logger.info('agent.turn.cancel', {
      thread,
      inflight: this.inflight?.input.thread === thread,
      queued: this.slots.filter((s) => s.input.thread === thread && !s.started).length,
    });
    for (const slot of this.slots) {
      if (slot.input.thread !== thread) continue;
      if (!slot.started) slot.cancelledBeforeStart = true;
    }
    if (this.inflight !== null && this.inflight.input.thread === thread) {
      this.inflight.abort.abort();
    }
  }

  queueLength(): number {
    return this.slots.filter((s) => !s.started).length;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) {
      if (!slot.started) slot.cancelledBeforeStart = true;
    }
    if (this.inflight !== null) this.inflight.abort.abort();
  }

  private async runSlot(slot: TurnSlot): Promise<void> {
    if (this.disposed || slot.cancelledBeforeStart) {
      slot.events.push({ type: 'done', cancelled: true });
      slot.events.close();
      this.removeSlot(slot);
      return;
    }
    slot.started = true;
    this.inflight = slot;
    try {
      await this.drive(slot);
    } finally {
      this.inflight = null;
      this.removeSlot(slot);
    }
  }

  private removeSlot(slot: TurnSlot): void {
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
  }

  private async drive(slot: TurnSlot): Promise<void> {
    const thread = slot.input.thread;
    const agentId = this.agentIdFor(thread);
    const turnHandle =
      this.tracer !== undefined
        ? this.tracer.beginTurn({
            sessionId: thread,
            metadata: {
              threadId: thread,
              agentId,
              turnEnqueuedAt: slot.enqueuedAt,
            },
            tags: ['leo', `agent:${agentId ?? 'main'}`],
            name: 'leo.turn',
          })
        : null;
    const turn: TurnBinding = {
      thread,
      message: slot.input.message,
      focus: slot.focus,
      enqueuedAt: slot.enqueuedAt,
      signal: slot.abort.signal,
      events: slot.events,
      agentId,
      ...(turnHandle !== null ? { traceContext: turnHandle.traceContext } : {}),
    };
    const deps: GraphDeps = {
      provider: this.provider,
      logger: this.logger,
      model: this.model,
      skillListing: this.skillListing,
      rag: this.rag,
      ragEngine: this.ragEngine,
      budget: this.budget,
      clock: this.clock,
      toolRegistry: this.toolRegistry,
      vault: this.vault ?? noopVault,
      editor: this.editor ?? noopEditor,
      ...(this.navigator !== null ? { navigator: this.navigator } : {}),
      maxToolRoundTrips: this.maxToolRoundTrips,
      ...(this.allowedToolsForThread !== undefined
        ? { allowedToolsForThread: this.allowedToolsForThread }
        : {}),
      ...(this.markThreadAllowed !== undefined
        ? { markThreadAllowed: this.markThreadAllowed }
        : {}),
      planMode: this.planMode,
      agentIdFor: this.agentIdFor,
      microcompact: {
        enabled: this.microcompactEnabled,
        gapThresholdMinutes: this.microcompactGapMinutes,
        keepRecent: this.microcompactKeepRecent,
        isCompactable: this.microcompactIsCompactable ?? this.defaultIsCompactable.bind(this),
      },
      autocompact: this.autocompactOptions,
      getHistory: (t): readonly AgentHistoryMessage[] => this.getHistory(t),
      appendHistory: (t, m): void => this.appendHistory(t, m),
    };
    const graph = buildAgentGraph(deps, turn);
    const config = {
      configurable: { thread_id: `${thread}:${slot.enqueuedAt}` },
      signal: slot.abort.signal,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let input: any = {};
      for (;;) {
        const result = (await graph.invoke(input, config)) as Record<string, unknown>;
        if (!isInterrupted<ToolConfirmationInterruptPayload>(result)) break;
        if (slot.abort.signal.aborted) break;
        const interrupts = result[INTERRUPT] as { value?: ToolConfirmationInterruptPayload }[];
        const intr = interrupts[0];
        if (intr === undefined || intr.value === undefined) break;
        const payload = intr.value;
        const decision = await this.awaitDecision(slot, payload);
        if (slot.abort.signal.aborted) break;
        input = new Command({ resume: decision });
      }
      if (slot.abort.signal.aborted && !slot.events.closed) {
        slot.events.push({ type: 'done', cancelled: true });
        slot.events.close();
      }
    } catch (err) {
      if (slot.abort.signal.aborted) {
        if (!slot.events.closed) {
          slot.events.push({ type: 'done', cancelled: true });
          slot.events.close();
        }
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      if (!slot.events.closed) {
        slot.events.push({ type: 'error', error });
        slot.events.close();
      }
      this.logger.error('agent.turn.done', {
        thread,
        cancelled: false,
        errored: true,
        error: error.message,
      });
    } finally {
      if (turnHandle !== null) {
        try {
          await turnHandle.end();
        } catch {
          /* logged inside tracer */
        }
      }
    }
  }

  private awaitDecision(
    slot: TurnSlot,
    payload: ToolConfirmationInterruptPayload,
  ): Promise<ConfirmationDecision> {
    return new Promise<ConfirmationDecision>((resolve) => {
      let settled = false;
      const safe = (d: ConfirmationDecision): void => {
        if (settled) return;
        settled = true;
        resolve(d);
      };
      const onAbort = (): void => safe('deny');
      if (slot.abort.signal.aborted) {
        safe('deny');
        return;
      }
      slot.abort.signal.addEventListener('abort', onAbort, { once: true });
      slot.events.push({
        type: 'tool_confirmation',
        request: {
          toolId: payload.toolId,
          thread: payload.thread,
          argsJson: payload.argsJson,
          category: payload.category,
        },
        resolve: (d: ToolConfirmationDecision): void => safe(d),
      });
    });
  }

  private getHistory(thread: ThreadId): readonly AgentHistoryMessage[] {
    return this.historyByThread.get(thread) ?? [];
  }

  private appendHistory(thread: ThreadId, msg: AgentHistoryMessage): void {
    const existing = this.historyByThread.get(thread);
    if (existing === undefined) {
      this.historyByThread.set(thread, [msg]);
      return;
    }
    existing.push(msg);
  }

  private defaultIsCompactable(toolName: string): boolean {
    if (BUILTIN_COMPACTABLE_TOOLS.has(toolName)) return true;
    if (this.toolRegistry === null) return false;
    const spec = this.toolRegistry.lookup(toolName) as
      | { readonly compactable?: boolean }
      | undefined;
    return spec !== undefined && spec.compactable === true;
  }
}

const noopVault: VaultAdapter = {
  async read(): Promise<string> {
    throw new Error('AgentRunner: no vault wired');
  },
  async write(): Promise<void> {
    throw new Error('AgentRunner: no vault wired');
  },
  async exists(): Promise<boolean> {
    return false;
  },
  async list(): Promise<{ files: readonly string[]; folders: readonly string[] }> {
    return { files: [], folders: [] };
  },
  async mkdir(): Promise<void> {
    throw new Error('AgentRunner: no vault wired');
  },
  async remove(): Promise<void> {
    throw new Error('AgentRunner: no vault wired');
  },
  async rename(): Promise<void> {
    throw new Error('AgentRunner: no vault wired');
  },
} as unknown as VaultAdapter;

const noopEditor: EditNoteBridge = {
  isActiveNote: (): boolean => false,
  applyActiveEdit: async (): Promise<
    { ok: true; bytesWritten: number; undo: () => void } | { ok: false; error: string }
  > => ({ ok: false, error: 'AgentRunner: no editor wired' }),
};
