import { Command, INTERRUPT, isInterrupted } from '@langchain/langgraph';
import type { Logger } from '@/platform/Logger';
import {
  buildAgentGraph,
  type EventChannel,
  type GraphDeps,
  type ToolConfirmationInterruptPayload,
  type TurnBinding,
} from '@/agent/graph';
import { type ConfirmationController, prettifyArgs } from '@/agent/confirmationController';
import type { StreamEvent } from '@/agent/streamEvents';
import { TASK_LOG } from './loggingNamespaces';

export interface SubagentTurnDeps {
  readonly graphDeps: GraphDeps;
  readonly turn: TurnBinding;
  readonly confirmation: ConfirmationController;
  readonly signal: AbortSignal;
  readonly logger?: Logger;
}

export interface SubagentTurnResult {
  readonly finalAssistantText: string;
  readonly toolResultCount: number;
  readonly cancelled: boolean;
  readonly errored: boolean;
  readonly errorMessage: string | null;
}

export interface SubagentEventSink {
  onToolResult(toolId: string): void;
  onFirstEvent(): void;
}

/**
 * Drive a single subagent turn through `buildAgentGraph`. Mirrors
 * `AgentRunner.runGraphLoop` but routes tool-confirmation interrupts straight
 * through the parent's singleton `ConfirmationController` so write-tool dialogs
 * appear in the main UI. The subagent's own `EventChannel` is consumed by the
 * widget projection loop; events are NOT forwarded to the parent chat stream.
 */
interface SubagentRunOutcome {
  readonly cancelled: boolean;
  readonly errored: boolean;
  readonly errorMessage: string | null;
}

async function handleInterruptResume(
  deps: SubagentTurnDeps,
  result: Record<string, unknown>,
): Promise<Command | null> {
  if (deps.signal.aborted) return null;
  const interrupts = result[INTERRUPT] as { value?: ToolConfirmationInterruptPayload }[];
  const intr = interrupts[0];
  if (intr?.value === undefined) return null;
  const argsJson = intr.value.argsJson;
  const decision = await deps.confirmation.request({
    toolId: intr.value.toolId,
    thread: intr.value.thread,
    argsJson,
    argsPretty: prettifyArgs(argsJson),
    category: intr.value.category,
    disableAllowForThread: true,
  });
  if (deps.signal.aborted) return null;
  return new Command({ resume: decision });
}

async function runGraphLoop(
  deps: SubagentTurnDeps,
  graph: ReturnType<typeof buildAgentGraph>,
  config: { configurable: { thread_id: string }; signal: AbortSignal },
): Promise<SubagentRunOutcome> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let input: any = {};
  try {
    for (;;) {
      const result = (await graph.invoke(input, config)) as Record<string, unknown>;
      if (!isInterrupted<ToolConfirmationInterruptPayload>(result)) break;
      const next = await handleInterruptResume(deps, result);
      if (next === null)
        return { cancelled: deps.signal.aborted, errored: false, errorMessage: null };
      input = next;
    }
    return { cancelled: false, errored: false, errorMessage: null };
  } catch (err) {
    if (deps.signal.aborted) {
      return { cancelled: true, errored: false, errorMessage: null };
    }
    const errorMessage = err instanceof Error ? err.message : String(err);
    deps.logger?.error(TASK_LOG.error, { thread: deps.turn.thread, error: errorMessage });
    return { cancelled: false, errored: true, errorMessage };
  }
}

function lastAssistantText(history: readonly { role: string; content: string }[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]!;
    if (m.role === 'assistant' && m.content.length > 0) return m.content;
  }
  return '';
}

export async function runSubagentTurn(
  deps: SubagentTurnDeps,
  sink: SubagentEventSink,
): Promise<SubagentTurnResult> {
  const graph = buildAgentGraph(deps.graphDeps, deps.turn);
  const config = {
    configurable: { thread_id: deps.turn.thread },
    signal: deps.signal,
  };

  const counter = { count: 0 };
  const drainPromise = drainEvents(deps.turn.events, sink, deps.signal, counter);

  let outcome: SubagentRunOutcome;
  try {
    outcome = await runGraphLoop(deps, graph, config);
  } finally {
    if (!deps.turn.events.closed) deps.turn.events.close();
    await drainPromise;
  }

  const cancelled = outcome.cancelled || deps.signal.aborted;
  return {
    finalAssistantText: lastAssistantText(deps.graphDeps.getHistory(deps.turn.thread)),
    toolResultCount: counter.count,
    cancelled,
    errored: outcome.errored,
    errorMessage: outcome.errorMessage,
  };
}

async function drainEvents(
  channel: EventChannel<StreamEvent>,
  sink: SubagentEventSink,
  signal: AbortSignal,
  counter: { count: number },
): Promise<void> {
  let firstSeen = false;
  try {
    for await (const ev of channel.iterable()) {
      if (signal.aborted) break;
      if (!firstSeen) {
        firstSeen = true;
        try {
          sink.onFirstEvent();
        } catch {
          /* sink errors isolated */
        }
      }
      if (ev.type === 'tool_result') {
        counter.count += 1;
        try {
          sink.onToolResult(ev.id);
        } catch {
          /* sink errors isolated */
        }
      }
    }
  } catch {
    /* drain swallows — orchestrator decides terminal outcome */
  }
}
