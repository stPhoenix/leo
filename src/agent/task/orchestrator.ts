import type { Logger } from '@/platform/Logger';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import {
  EventChannel,
  type GraphDeps,
  type GraphSkillListingProvider,
  type TurnBinding,
} from '@/agent/graph';
import type { ConfirmationController } from '@/agent/confirmationController';
import type { StreamEvent } from '@/agent/streamEvents';
import type { AgentHistoryMessage, SkillListingSegment, ThreadId } from '@/agent/types';
import { TASK_LOG } from './loggingNamespaces';
import { generateTaskRunId } from './runId';
import { SubagentToolRegistryProxy } from './toolRegistryProxy';
import { runSubagentTurn } from './subgraph';
import { TaskWidgetController } from './widgetController';
import type { TaskTerminalSnapshot } from './terminalSnapshot';
import type { TaskErrorCode } from './widgetState';

export const DEFAULT_TASK_TIMEOUT_MS = 600_000; // 10 min
export const DEFAULT_MAX_CONCURRENT_TASKS = 4;
export const TASK_SUBAGENT_ID_PREFIX = 'task:';

export interface TaskToolErrorPayload {
  readonly code: TaskErrorCode;
  readonly message: string;
}

export interface TaskToolResult {
  readonly ok: boolean;
  readonly runId: string;
  readonly summary: string;
  readonly toolCallsCount: number;
  readonly durationMs: number;
  readonly error: TaskToolErrorPayload | null;
}

export interface TaskRunHandle {
  readonly runId: string;
  /** Parent thread id — the user-facing chat thread. */
  readonly threadId: ThreadId;
  /** Synthetic sub-thread id used internally for graph state isolation. */
  readonly subThreadId: ThreadId;
  readonly controller: TaskWidgetController;
  readonly terminal: Promise<TaskToolResult>;
  state(): TaskWidgetController;
  cancel(): void;
}

export type TaskOrchestratorStartResult =
  | { readonly ok: true; readonly handle: TaskRunHandle }
  | { readonly ok: false; readonly busy: true; readonly activeRunIds: readonly string[] };

export interface TaskOrchestratorDeps {
  readonly buildGraphDeps: () => GraphDeps;
  readonly confirmation: ConfirmationController;
  readonly subagentPreamble: string;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly maxConcurrent?: number;
  readonly defaultTimeoutMs?: number;
  /**
   * Called once per run after the subgraph starts. The host wires the
   * controller into the live registry and appends the chat widget row.
   * Mirrors `delegateExternal.onHandle`.
   */
  readonly onHandle?: (handle: TaskRunHandle) => void;
  /**
   * Called once per run after the subgraph reaches a terminal state. The
   * host swaps the live widget row for the terminal snapshot row.
   */
  readonly persistSnapshot?: (snapshot: TaskTerminalSnapshot) => void;
}

export interface TaskOrchestratorStartInput {
  readonly parentThreadId: ThreadId;
  readonly prompt: string;
  readonly summaryInstructions?: string;
  readonly timeoutMs?: number;
  readonly signal: AbortSignal;
}

export class TaskOrchestrator {
  private readonly liveHandles = new Map<string, TaskRunHandle>();
  private readonly logger: Logger | undefined;
  private readonly now: () => number;
  private readonly maxConcurrent: number;
  private readonly defaultTimeoutMs: number;

  constructor(private readonly deps: TaskOrchestratorDeps) {
    this.logger = deps.logger;
    this.now = deps.now ?? ((): number => Date.now());
    this.maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT_TASKS;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  }

  liveHandlesSnapshot(): readonly TaskRunHandle[] {
    return [...this.liveHandles.values()];
  }

  findHandle(runId: string): TaskRunHandle | null {
    return this.liveHandles.get(runId) ?? null;
  }

  start(input: TaskOrchestratorStartInput): TaskOrchestratorStartResult {
    if (this.liveHandles.size >= this.maxConcurrent) {
      return {
        ok: false,
        busy: true,
        activeRunIds: [...this.liveHandles.keys()],
      };
    }
    const runId = generateTaskRunId();
    const subThreadId = `${input.parentThreadId}:task:${runId}`;
    const startedAt = this.now();

    const parentDeps = this.deps.buildGraphDeps();
    const privateHistory = new Map<ThreadId, AgentHistoryMessage[]>();

    const skillListing = this.composeSkillListing(parentDeps.skillListing, subThreadId, input);

    const agentIdFor = (thread: ThreadId): string | null => {
      if (thread === subThreadId) return `${TASK_SUBAGENT_ID_PREFIX}${runId}`;
      return parentDeps.agentIdFor(thread);
    };

    const childRegistry =
      parentDeps.toolRegistry !== null
        ? new SubagentToolRegistryProxy(parentDeps.toolRegistry)
        : null;

    const graphDeps: GraphDeps = {
      ...parentDeps,
      toolRegistry: childRegistry,
      planMode: null,
      autocompact: null,
      skillListing,
      agentIdFor,
      getHistory: (t): readonly AgentHistoryMessage[] => privateHistory.get(t) ?? [],
      appendHistory: (t, m): void => {
        const existing = privateHistory.get(t);
        if (existing === undefined) {
          privateHistory.set(t, [m]);
          return;
        }
        existing.push(m);
      },
    };

    const internalAbort = new AbortController();
    const onParentAbort = (): void => {
      this.logger?.warn(TASK_LOG.ctxSignalAborted, {
        runId,
        thread: input.parentThreadId,
      });
      internalAbort.abort();
    };
    if (input.signal.aborted) {
      internalAbort.abort();
    } else {
      input.signal.addEventListener('abort', onParentAbort, { once: true });
    }
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => {
      this.logger?.warn(TASK_LOG.error, {
        runId,
        thread: input.parentThreadId,
        error: 'timeout',
        timeoutMs,
      });
      internalAbort.abort();
    }, timeoutMs);
    // Don't keep the Node process alive in tests / SSR.
    if (typeof (timer as NodeJS.Timeout).unref === 'function') {
      (timer as NodeJS.Timeout).unref();
    }

    const events = new EventChannel<StreamEvent>();
    const turn: TurnBinding = {
      thread: subThreadId,
      message: { role: 'user', content: input.prompt },
      focus: NULL_FOCUSED_CONTEXT,
      enqueuedAt: new Date(startedAt).toISOString(),
      signal: internalAbort.signal,
      events,
      agentId: `${TASK_SUBAGENT_ID_PREFIX}${runId}`,
    };

    const controller = new TaskWidgetController({
      runId,
      threadId: input.parentThreadId,
      prompt: input.prompt,
    });
    controller.setPhase('preparing');

    let resolveTerminal!: (r: TaskToolResult) => void;
    const terminal = new Promise<TaskToolResult>((resolve) => {
      resolveTerminal = resolve;
    });

    const handle: TaskRunHandle = {
      runId,
      threadId: input.parentThreadId,
      subThreadId,
      controller,
      terminal,
      state: () => controller,
      cancel: () => internalAbort.abort(),
    };
    this.liveHandles.set(runId, handle);

    this.logger?.info(TASK_LOG.start, {
      runId,
      thread: input.parentThreadId,
      subThread: subThreadId,
      timeoutMs,
      promptChars: input.prompt.length,
    });
    try {
      this.deps.onHandle?.(handle);
    } catch (err) {
      this.logger?.warn('task.onHandle.error', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    void this.driveRun({
      handle,
      graphDeps,
      turn,
      internalAbort,
      timer,
      startedAt,
      onParentAbort,
      parentSignal: input.signal,
      resolveTerminal,
    });

    return { ok: true, handle };
  }

  private async driveRun(args: {
    readonly handle: TaskRunHandle;
    readonly graphDeps: GraphDeps;
    readonly turn: TurnBinding;
    readonly internalAbort: AbortController;
    readonly timer: ReturnType<typeof setTimeout>;
    readonly startedAt: number;
    readonly onParentAbort: () => void;
    readonly parentSignal: AbortSignal;
    readonly resolveTerminal: (r: TaskToolResult) => void;
  }): Promise<void> {
    const {
      handle,
      graphDeps,
      turn,
      internalAbort,
      timer,
      startedAt,
      onParentAbort,
      parentSignal,
      resolveTerminal,
    } = args;
    let result: TaskToolResult;
    try {
      const turnResult = await runSubagentTurn(
        {
          graphDeps,
          turn,
          confirmation: this.deps.confirmation,
          signal: internalAbort.signal,
          ...(this.logger !== undefined ? { logger: this.logger } : {}),
        },
        {
          onFirstEvent: () => {
            if (handle.controller.viewModel().phase === 'preparing') {
              handle.controller.setPhase('running');
            }
          },
          onToolResult: (toolId) => {
            handle.controller.noteToolCall(toolId);
            this.logger?.debug(TASK_LOG.toolCall, { runId: handle.runId, toolId });
          },
        },
      );

      if (turnResult.cancelled) {
        handle.controller.recordError('cancelled', 'Task subagent run cancelled');
        result = this.buildResult(handle, startedAt, 'cancelled', 'Task subagent run cancelled');
      } else if (turnResult.errored) {
        handle.controller.recordError(
          'graph_throw',
          turnResult.errorMessage ?? 'subagent graph threw',
        );
        result = this.buildResult(
          handle,
          startedAt,
          'graph_throw',
          turnResult.errorMessage ?? 'subagent graph threw',
        );
      } else if (turnResult.finalAssistantText.length === 0) {
        handle.controller.recordError('no_summary', 'subagent produced no final text');
        result = this.buildResult(
          handle,
          startedAt,
          'no_summary',
          'subagent produced no final text',
        );
      } else {
        handle.controller.setPhase('summarizing', { summary: turnResult.finalAssistantText });
        handle.controller.setPhase('done', { summary: turnResult.finalAssistantText });
        const durationMs = this.now() - startedAt;
        result = {
          ok: true,
          runId: handle.runId,
          summary: turnResult.finalAssistantText,
          toolCallsCount: handle.controller.viewModel().toolCallsCount,
          durationMs,
          error: null,
        };
        this.logger?.info(TASK_LOG.done, {
          runId: handle.runId,
          durationMs,
          toolCallsCount: result.toolCallsCount,
          summaryChars: turnResult.finalAssistantText.length,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      handle.controller.recordError('graph_throw', msg);
      result = this.buildResult(handle, startedAt, 'graph_throw', msg);
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onParentAbort);
      this.liveHandles.delete(handle.runId);
    }

    try {
      const snapshot = handle.controller.toTerminalSnapshot();
      this.deps.persistSnapshot?.(snapshot);
    } catch (err) {
      this.logger?.warn('task.persist.error', {
        runId: handle.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    resolveTerminal(result);
  }

  private buildResult(
    handle: TaskRunHandle,
    startedAt: number,
    code: TaskErrorCode,
    message: string,
  ): TaskToolResult {
    return {
      ok: false,
      runId: handle.runId,
      summary: '',
      toolCallsCount: handle.controller.viewModel().toolCallsCount,
      durationMs: this.now() - startedAt,
      error: { code, message },
    };
  }

  private composeSkillListing(
    parent: GraphSkillListingProvider | null,
    subThreadId: ThreadId,
    input: TaskOrchestratorStartInput,
  ): GraphSkillListingProvider {
    const preamble =
      input.summaryInstructions !== undefined && input.summaryInstructions.length > 0
        ? `${this.deps.subagentPreamble}\n\nFinal answer must conform to:\n${input.summaryInstructions}`
        : this.deps.subagentPreamble;
    return {
      buildFor: ({ thread, agentId }): SkillListingSegment | null => {
        if (thread === subThreadId) {
          return { content: preamble, skillCount: 1 };
        }
        return parent?.buildFor({ thread, agentId }) ?? null;
      },
    };
  }
}
