import type { Logger } from '@/platform/Logger';
import type { FocusedContext } from '@/editor/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type {
  ChatMessage,
  OpenAITool,
  ProviderChatRequest,
  StreamEvent,
  ToolCallRequest,
} from '@/providers/types';
import type { ToolRegistry } from '@/tools/toolRegistry';
import type { PlanModeController } from './planModeController';
import { assembleContext, renderPrompt } from './contextAssembler';
import { truncate, type TruncationResult } from './truncator';
import {
  BUILTIN_COMPACTABLE_TOOLS,
  isMicrocompactBoundary,
  microcompactMessages,
  type CompactAssistantMessage,
  type CompactMessage,
  type CompactToolCallRef,
  type CompactToolMessage,
} from './microcompact';
import {
  type AgentAssistantMessage,
  type AgentHistoryMessage,
  type AgentTurnEvent,
  type AgentUserMessage,
  type RagHit,
  type SkillListingSegment,
  type ThreadId,
  type TurnInput,
} from './types';
import { isSkillInvocationEnvelope } from '@/tools/builtin/skillTool';
import type { ContextModifier } from '@/skills/types';

export interface AgentRunnerProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
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
  readonly maxToolRoundTrips?: number;
  readonly confirmTool?: (req: {
    readonly toolId: string;
    readonly thread: ThreadId;
    readonly argsJson: string;
    readonly category: 'read' | 'write';
  }) => Promise<'allow-once' | 'allow-thread' | 'deny'>;
  readonly allowedToolsForThread?: (thread: ThreadId) => ReadonlySet<string>;
  readonly markThreadAllowed?: (thread: ThreadId, toolId: string) => void;
  readonly planMode?: PlanModeController;
  readonly agentIdFor?: (thread: ThreadId) => string | null;
  readonly microcompact?: MicrocompactAgentOptions;
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
  readonly events: EventChannel<AgentTurnEvent>;
  readonly enqueuedAt: string;
  cancelledBeforeStart: boolean;
  started: boolean;
}

const DEFAULT_BUDGET_TOKENS = 16_000;
const DEFAULT_MAX_TOOL_ROUND_TRIPS = 8;

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
  private readonly maxToolRoundTrips: number;
  private readonly confirmTool: AgentRunnerOptions['confirmTool'];
  private readonly allowedToolsForThread: AgentRunnerOptions['allowedToolsForThread'];
  private readonly markThreadAllowed: AgentRunnerOptions['markThreadAllowed'];
  private readonly planMode: PlanModeController | null;
  private readonly agentIdFor: (thread: ThreadId) => string | null;
  private readonly microcompactEnabled: boolean;
  private readonly microcompactGapMinutes: number | undefined;
  private readonly microcompactKeepRecent: number | undefined;
  private readonly microcompactIsCompactable: ((toolName: string) => boolean) | undefined;
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
    this.maxToolRoundTrips = opts.maxToolRoundTrips ?? DEFAULT_MAX_TOOL_ROUND_TRIPS;
    this.confirmTool = opts.confirmTool;
    this.allowedToolsForThread = opts.allowedToolsForThread;
    this.markThreadAllowed = opts.markThreadAllowed;
    this.planMode = opts.planMode ?? null;
    this.agentIdFor = opts.agentIdFor ?? ((): string | null => null);
    const mc = opts.microcompact ?? {};
    this.microcompactEnabled = mc.enabled ?? true;
    this.microcompactGapMinutes = mc.gapThresholdMinutes;
    this.microcompactKeepRecent = mc.keepRecent;
    this.microcompactIsCompactable = mc.isCompactable;
  }

  send(input: TurnInput): AsyncIterable<AgentTurnEvent> {
    const focus: FocusedContext = this.focus.current() ?? NULL_FOCUSED_CONTEXT;
    const abort = new AbortController();
    const events = new EventChannel<AgentTurnEvent>();
    const slot: TurnSlot = {
      input,
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
    const history = this.getHistory(thread);
    const historyWithUser: readonly AgentHistoryMessage[] = [...history, slot.input.message];
    let ragHits: readonly RagHit[] = [];
    const ragStart = nowMs();
    try {
      if (this.ragEngine !== null) {
        const engineHits = await this.ragEngine.query(slot.input.message.content, {
          signal: slot.abort.signal,
        });
        ragHits = engineHits.map(
          (h): RagHit => ({
            path: h.path,
            score: h.score,
            line_start: h.line_start,
            line_end: h.line_end,
          }),
        );
      } else {
        ragHits = await this.rag.query(slot.input.message, slot.focus);
      }
    } catch (err) {
      this.logger.warn('agent.rag.failure', {
        thread,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.logger.debug('agent.turn.rag.ms', {
      thread,
      ms: Math.round(nowMs() - ragStart),
    });
    this.logger.debug('agent.turn.rag.hits', {
      thread,
      hits: ragHits.length,
    });
    const agentId = this.agentIdFor(thread);
    const skillListing = this.skillListing?.buildFor({ thread, agentId }) ?? null;
    const prompt = assembleContext({
      focus: slot.focus,
      ragHits,
      history: historyWithUser,
      skillListing,
    });
    const truncation: TruncationResult = truncate(prompt.segments, this.budget);
    if (truncation.dropped.history > 0 || truncation.dropped.ragHits > 0) {
      this.logger.info('agent.turn.truncate', {
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
      focus: slot.focus,
    });
    if (this.planMode !== null) {
      const attachments = this.planMode.drainAttachments(thread);
      for (const reminder of attachments) {
        baseMessages.push({ role: 'system', content: reminder.body });
      }
      const staleReminder = this.planMode.maybeInjectStaleTodoReminder(thread, agentId);
      if (staleReminder !== null) {
        baseMessages.push({ role: 'system', content: staleReminder });
      }
    }
    const allToolSpecs: readonly OpenAITool[] =
      this.toolRegistry !== null ? this.toolRegistry.toOpenAITools(thread) : [];
    let toolAllowlist: ReadonlySet<string> | null = null;
    let effectiveModel = this.model();
    const applyContextModifier = (modifier: ContextModifier): void => {
      if (modifier.allowedTools !== undefined && modifier.allowedTools.length > 0) {
        toolAllowlist = new Set(modifier.allowedTools);
      }
      if (modifier.model !== undefined) effectiveModel = modifier.model;
    };
    const tools = (): readonly OpenAITool[] =>
      toolAllowlist === null
        ? allToolSpecs
        : allToolSpecs.filter((t) => toolAllowlist!.has(t.function.name));
    this.logger.info('agent.turn.start', {
      thread,
      model: effectiveModel,
      messages: baseMessages.length,
      tools: allToolSpecs.length,
      focusFile: slot.focus.file,
      enqueuedAt: slot.enqueuedAt,
    });
    const workingMessages: ChatMessage[] = [...baseMessages];
    const workingTimestamps: number[] = baseMessages.map(() => this.clock().getTime());
    let assistantText = '';
    let errored = false;
    let cancelled = false;
    let turnHadToolCall = false;
    let turnCalledTodoWrite = false;
    for (let roundTrip = 0; roundTrip < this.maxToolRoundTrips; roundTrip += 1) {
      if (slot.abort.signal.aborted) {
        cancelled = true;
        break;
      }
      this.applyMicrocompactPass(workingMessages, workingTimestamps);
      const activeTools = tools();
      const req: ProviderChatRequest = {
        model: effectiveModel,
        messages: workingMessages,
        ...(activeTools.length > 0 ? { tools: activeTools } : {}),
      };
      const pendingToolCalls: ToolCallRequest[] = [];
      let iterationAssistant = '';
      try {
        for await (const ev of this.provider.stream(req, slot.abort.signal)) {
          if (slot.abort.signal.aborted) break;
          if (ev.type === 'token') {
            iterationAssistant += ev.text;
            slot.events.push({ type: 'token', text: ev.text });
          } else if (ev.type === 'tool_call') {
            pendingToolCalls.push(ev.call);
          } else if (ev.type === 'usage') {
            slot.events.push({ type: 'usage', input: ev.input, output: ev.output });
          } else if (ev.type === 'error') {
            errored = true;
            slot.events.push({ type: 'error', error: ev.error });
            this.logger.error('agent.turn.done', {
              thread,
              cancelled: false,
              errored: true,
              error: ev.error.message,
            });
            slot.events.close();
            return;
          } else if (ev.type === 'done') {
            break;
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (slot.abort.signal.aborted) {
          cancelled = true;
          break;
        }
        errored = true;
        slot.events.push({ type: 'error', error });
        this.logger.error('agent.turn.done', {
          thread,
          cancelled: false,
          errored: true,
          error: error.message,
        });
        slot.events.close();
        return;
      }
      assistantText += iterationAssistant;
      if (pendingToolCalls.length > 0) turnHadToolCall = true;
      for (const c of pendingToolCalls) {
        if (c.name === 'TodoWrite') turnCalledTodoWrite = true;
      }
      if (pendingToolCalls.length === 0) break;
      workingMessages.push({
        role: 'assistant',
        content: iterationAssistant,
        toolCalls: pendingToolCalls,
      });
      workingTimestamps.push(this.clock().getTime());
      for (const call of pendingToolCalls) {
        if (slot.abort.signal.aborted) {
          cancelled = true;
          break;
        }
        const gated = this.applyPlanModeGate(call.name, thread);
        const result =
          gated ?? (await this.invokeWithConfirmation(call, thread, slot.abort.signal, agentId));
        const skillEnvelope =
          result.ok && isSkillInvocationEnvelope(result.data) ? result.data : null;
        const toolResultContent =
          skillEnvelope !== null
            ? JSON.stringify({
                ok: true,
                data: { skill: skillEnvelope.skillName, status: 'injected' },
              })
            : JSON.stringify(result);
        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: toolResultContent,
        });
        workingTimestamps.push(this.clock().getTime());
        if (skillEnvelope !== null) {
          for (const msg of skillEnvelope.messages) {
            workingMessages.push({
              role: msg.role === 'system' ? 'system' : 'user',
              content: msg.marker !== undefined ? `${msg.marker}\n${msg.content}` : msg.content,
            });
            workingTimestamps.push(this.clock().getTime());
          }
          if (skillEnvelope.contextModifier !== undefined) {
            applyContextModifier(skillEnvelope.contextModifier);
          }
        }
      }
      if (cancelled) break;
    }
    if (!cancelled) cancelled = slot.abort.signal.aborted;
    if (this.planMode !== null && !cancelled && !errored) {
      this.planMode.recordAssistantTurn(thread, {
        hasToolCall: turnHadToolCall,
        calledTodoWrite: turnCalledTodoWrite,
      });
    }
    this.appendHistory(thread, slot.input.message);
    if (!cancelled && !errored && assistantText.length > 0) {
      const assistant: AgentAssistantMessage = {
        role: 'assistant',
        content: assistantText,
      };
      this.appendHistory(thread, assistant);
    }
    slot.events.push({ type: 'done', cancelled });
    slot.events.close();
    this.logger.info('agent.turn.done', {
      thread,
      cancelled,
      errored: false,
      assistantChars: assistantText.length,
    });
  }

  private applyPlanModeGate(toolId: string, thread: ThreadId): { ok: false; error: string } | null {
    if (this.planMode === null) return null;
    if (this.planMode.getMode(thread) !== 'plan') return null;
    if (this.planMode.isToolAllowedInPlan(toolId)) return null;
    this.planMode.recordToolBlocked(thread, toolId);
    return { ok: false, error: `blocked by plan mode: ${toolId}` };
  }

  private async invokeWithConfirmation(
    call: ToolCallRequest,
    thread: ThreadId,
    signal: AbortSignal,
    agentId: string | null,
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    if (this.toolRegistry === null) {
      return { ok: false, error: `no tool registry for ${call.name}` };
    }
    const spec = this.toolRegistry.lookup(call.name);
    if (spec === undefined) {
      return { ok: false, error: `unknown tool: ${call.name}` };
    }
    const allowed =
      this.allowedToolsForThread !== undefined ? this.allowedToolsForThread(thread) : null;
    const threadAllowed = allowed !== null && allowed.has(call.name);
    if (spec.requiresConfirmation && !threadAllowed) {
      if (this.confirmTool === undefined) {
        this.logger.warn('tool.confirmation.denied_by_default', {
          toolId: call.name,
          thread,
          reason: 'no-confirm-hook',
        });
        return { ok: false, error: `user denied ${call.name}` };
      }
      const category = deriveCategory(spec);
      this.logger.info('tool.confirmation.request', {
        toolId: call.name,
        thread,
        category,
      });
      let decision: 'allow-once' | 'allow-thread' | 'deny';
      try {
        decision = await this.confirmTool({
          toolId: call.name,
          thread,
          argsJson: call.argsJson,
          category,
        });
      } catch {
        decision = 'deny';
      }
      this.logger.info(`tool.confirmation.${decision}`, {
        toolId: call.name,
        thread,
        decision,
      });
      if (decision === 'deny') {
        return { ok: false, error: `user denied ${call.name}` };
      }
      if (decision === 'allow-thread') {
        this.markThreadAllowed?.(thread, call.name);
      }
    }
    return this.toolRegistry.invoke(call.name, call.argsJson, {
      thread,
      signal,
      logger: this.logger,
      agentId,
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

  private applyMicrocompactPass(workingMessages: ChatMessage[], workingTimestamps: number[]): void {
    if (!this.microcompactEnabled) return;
    if (workingMessages.length === 0) return;
    const compactIn = toCompactMessages(workingMessages, workingTimestamps);
    const isCompactable = this.microcompactIsCompactable ?? this.defaultIsCompactable.bind(this);
    const now = this.clock().getTime();
    const res = microcompactMessages(compactIn, {
      now,
      ...(this.microcompactGapMinutes !== undefined
        ? { gapThresholdMinutes: this.microcompactGapMinutes }
        : {}),
      ...(this.microcompactKeepRecent !== undefined
        ? { keepRecent: this.microcompactKeepRecent }
        : {}),
      isCompactable,
      logger: {
        info: (event, fields): void => this.logger.info(event, fields),
      },
    });
    if (res === null) return;
    const rebuilt = fromCompactMessages(res.messages);
    workingMessages.length = 0;
    for (const m of rebuilt.messages) workingMessages.push(m);
    workingTimestamps.length = 0;
    for (const ts of rebuilt.timestamps) workingTimestamps.push(ts);
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

function toCompactMessages(
  messages: readonly ChatMessage[],
  timestamps: readonly number[],
): CompactMessage[] {
  const out: CompactMessage[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]!;
    const ts = timestamps[i];
    if (m.role === 'assistant') {
      const calls = m.toolCalls ?? [];
      const toolCalls: CompactToolCallRef[] = calls.map((c) => ({
        id: c.id,
        name: c.name,
        argsJson: c.argsJson,
      }));
      const assistant: CompactAssistantMessage = {
        role: 'assistant',
        content: m.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        ...(ts !== undefined ? { timestamp: ts } : {}),
      };
      out.push(assistant);
      continue;
    }
    if (m.role === 'tool') {
      const tool: CompactToolMessage = {
        role: 'tool',
        toolCallId: m.toolCallId ?? '',
        toolName: m.name ?? '',
        content: m.content,
        ...(ts !== undefined ? { timestamp: ts } : {}),
      };
      out.push(tool);
      continue;
    }
    if (m.role === 'user') {
      out.push({
        role: 'user',
        content: m.content,
        ...(ts !== undefined ? { timestamp: ts } : {}),
      });
      continue;
    }
    out.push({
      role: 'system',
      content: m.content,
      ...(ts !== undefined ? { timestamp: ts } : {}),
    });
  }
  return out;
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

function deriveCategory(spec: { readonly id: string }): 'read' | 'write' {
  const id = spec.id;
  if (id.startsWith('read_') || id === 'search_vault') return 'read';
  return 'write';
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

class EventChannel<T> {
  private readonly pending: T[] = [];
  private readonly resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const next = this.resolvers.shift();
    if (next !== undefined) {
      next({ value, done: false });
    } else {
      this.pending.push(value);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
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
          if (this.closed) {
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
