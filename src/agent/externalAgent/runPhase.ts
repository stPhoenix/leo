import type { ResultWriter } from './resultWriter';
import type { AdapterCallDeps, WriterDeps } from './subgraph';
import type { ExternalAgentState } from './state';

export const SUMMARY_MAX_CHARS = 500;

export type DelegateExternalToolResult =
  | {
      readonly ok: true;
      readonly folder: string;
      readonly files: readonly string[];
      readonly summary: string;
      readonly adapterId: string;
      readonly durationMs: number;
    }
  | {
      readonly ok: false;
      readonly cancelled: true;
      readonly phase: 'ready' | 'running' | 'preparing' | 'awaiting_clarify';
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
      readonly folder: string | null;
      readonly files: readonly string[];
    };

/**
 * Translate a terminal `ExternalAgentState` into the structured tool-result
 * payload consumed by the suspended `delegate_external` tool call (F06).
 */
export function buildToolResult(
  state: ExternalAgentState,
  cancelledFromPhase?: 'ready' | 'running' | 'preparing' | 'awaiting_clarify',
): DelegateExternalToolResult {
  if (state.phase === 'done') {
    const startedAt = state.startedAt ?? 0;
    const endedAt = state.endedAt ?? startedAt;
    return {
      ok: true,
      folder: state.resultFolder ?? '',
      files: state.writtenFiles,
      summary: state.textBuffer.slice(0, SUMMARY_MAX_CHARS),
      adapterId: state.selectedAdapterId ?? '',
      durationMs: Math.max(0, endedAt - startedAt),
    };
  }
  if (state.phase === 'cancelled') {
    return {
      ok: false,
      cancelled: true,
      phase: cancelledFromPhase ?? 'ready',
    };
  }
  // error
  const err = state.error ?? { code: 'unknown', message: 'no error message' };
  return {
    ok: false,
    error: { code: err.code, message: err.message },
    folder: state.resultFolder,
    files: state.writtenFiles,
  };
}

/**
 * Wraps F02's `ResultWriter` as a `WriterDeps` consumed by the subgraph
 * driver. The writer always emits `error.md` on failure paths (F02 invariant);
 * for the subgraph this means even an `error` writer call still returns a
 * `folder` + `writtenFiles` containing whatever flushed.
 */
export function createResultWriterDeps(writer: ResultWriter): WriterDeps {
  return {
    async write({ state, status }) {
      const result = await writer.write({
        runId: state.runId,
        threadId: state.threadId,
        adapterId: state.selectedAdapterId ?? 'unknown',
        refinedPrompt: state.refinedPrompt ?? state.originalAsk,
        startedAt: state.startedAt ?? Date.now(),
        endedAt: state.endedAt ?? Date.now(),
        textBuffer: state.textBuffer,
        files: state.pendingFiles,
        ...(status === 'error' && state.error !== null ? { error: state.error } : {}),
      });
      return {
        ok: result.ok,
        folder: result.ok ? result.folder : (result.folder ?? ''),
        writtenFiles: result.writtenFiles,
      };
    },
  };
}

/**
 * Pass-through `AdapterCallDeps`: the subgraph already owns the
 * `ExternalAgentInput` shape; this helper exists so wiring can swap in a
 * tracing decorator later without touching the driver.
 */
export function createPassthroughAdapterCallDeps(): AdapterCallDeps {
  return {
    start({ adapter, refinedAsk, systemPrompt, signal, timeoutMs, config, runId, threadId }) {
      return adapter.start({
        refinedAsk,
        systemPrompt,
        signal,
        timeoutMs,
        config,
        runId,
        ...(threadId !== undefined ? { threadId } : {}),
      });
    },
  };
}
