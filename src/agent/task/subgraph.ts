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
export async function runSubagentTurn(
  deps: SubagentTurnDeps,
  sink: SubagentEventSink,
): Promise<SubagentTurnResult> {
  const graph = buildAgentGraph(deps.graphDeps, deps.turn);
  const config = {
    configurable: { thread_id: deps.turn.thread },
    signal: deps.signal,
  };

  let cancelled = false;
  let errored = false;
  let errorMessage: string | null = null;

  const counter = { count: 0 };
  const drainPromise = drainEvents(deps.turn.events, sink, deps.signal, counter);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let input: any = {};
  try {
    for (;;) {
      const result = (await graph.invoke(input, config)) as Record<string, unknown>;
      if (!isInterrupted<ToolConfirmationInterruptPayload>(result)) break;
      if (deps.signal.aborted) {
        cancelled = true;
        break;
      }
      const interrupts = result[INTERRUPT] as { value?: ToolConfirmationInterruptPayload }[];
      const intr = interrupts[0];
      if (intr?.value === undefined) break;
      const argsJson = intr.value.argsJson;
      const decision = await deps.confirmation.request({
        toolId: intr.value.toolId,
        thread: intr.value.thread,
        argsJson,
        argsPretty: prettifyArgs(argsJson),
        category: intr.value.category,
        disableAllowForThread: true,
      });
      if (deps.signal.aborted) {
        cancelled = true;
        break;
      }
      input = new Command({ resume: decision });
    }
  } catch (err) {
    if (deps.signal.aborted) {
      cancelled = true;
    } else {
      errored = true;
      errorMessage = err instanceof Error ? err.message : String(err);
      deps.logger?.error(TASK_LOG.error, {
        thread: deps.turn.thread,
        error: errorMessage,
      });
    }
  } finally {
    if (!deps.turn.events.closed) deps.turn.events.close();
    await drainPromise;
  }

  cancelled = cancelled || deps.signal.aborted;
  const history = deps.graphDeps.getHistory(deps.turn.thread);
  let finalAssistantText = '';
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]!;
    if (m.role === 'assistant' && m.content.length > 0) {
      finalAssistantText = m.content;
      break;
    }
  }
  return {
    finalAssistantText,
    toolResultCount: counter.count,
    cancelled,
    errored,
    errorMessage,
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
