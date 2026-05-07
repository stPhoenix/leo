import type { Logger } from '@/platform/Logger';
import type { ProviderTraceContext } from '@/providers/types';
import { generateCanvasRunId } from './runIdRegistry';
import {
  defaultCanvasTargetPath,
  startCanvasRun,
  type CanvasSubgraphDeps,
  type RunHandle,
  type StartCanvasInput,
} from './subgraph';
import type { CanvasTerminalState } from './state';
import type { CanvasTerminalSnapshot } from './widget/terminalSnapshot';
import { buildCanvasTerminalSnapshot } from './widget/terminalSnapshot';
import {
  CanvasWidgetController,
  type CanvasConfigInit,
  type CanvasConfigOverride,
  type CanvasPickerDeps,
  type CanvasWidgetActions,
} from './widget/widgetController';
import { makeInitialCanvasViewModel, type CanvasViewModel } from './widget/widgetState';
import type { CanvasOp } from './mutex';
import {
  registerCanvasLiveController,
  releaseCanvasLiveController,
} from './liveControllerRegistry';

export interface CanvasTraceHandle {
  readonly traceConfig: ProviderTraceContext;
  end(): void | Promise<void>;
}

export type BeginCanvasTrace = (input: {
  readonly runId: string;
  readonly threadId: string;
  readonly op: string;
}) => CanvasTraceHandle | null;

export interface CanvasPickerWiring {
  readonly deps: CanvasPickerDeps;
  readonly buildInit: (input: {
    readonly originalAsk: string;
    readonly op: CanvasOp;
    readonly targetPath: string;
  }) => CanvasConfigInit;
  readonly applyOverride: (
    subgraph: CanvasSubgraphDeps,
    override: CanvasConfigOverride,
  ) => CanvasSubgraphDeps;
}

export interface CanvasAppendWidgetBlockInput {
  readonly runId: string;
  readonly threadId: string;
  readonly op: CanvasOp;
  readonly targetPath: string;
  readonly originalAsk: string;
}

export interface CanvasOrchestratorDeps {
  readonly subgraph: CanvasSubgraphDeps;
  readonly logger?: Logger;
  readonly persistSnapshot?: (snapshot: CanvasTerminalSnapshot) => void;
  readonly beginTrace?: BeginCanvasTrace;
  readonly picker?: CanvasPickerWiring;
  readonly appendWidgetBlock?: (input: CanvasAppendWidgetBlockInput) => void;
  readonly resolvePreviewing?: (
    runId: string,
    action: Parameters<NonNullable<CanvasWidgetActions['resolvePreviewing']>>[0],
  ) => void;
  readonly openPreview?: (path: string) => void;
}

export type CanvasStartResult =
  | {
      readonly ok: true;
      readonly handle: RunHandle;
      readonly terminal: Promise<CanvasTerminalState>;
    }
  | {
      readonly ok: false;
      readonly busy: { readonly activeRunId: string; readonly activeOp: string };
    }
  | {
      readonly ok: false;
      readonly cancelledByPicker: true;
    };

export class CanvasOrchestrator {
  private readonly liveHandles = new Map<string, RunHandle>();

  constructor(private readonly deps: CanvasOrchestratorDeps) {}

  findHandle(runId: string): RunHandle | null {
    return this.liveHandles.get(runId) ?? null;
  }

  liveHandlesSnapshot(): readonly RunHandle[] {
    return [...this.liveHandles.values()];
  }

  async start(input: StartCanvasInput): Promise<CanvasStartResult> {
    const runId = input.runId ?? generateCanvasRunId();
    const targetPath = resolveTargetPath(input);

    // Pre-build controller so the widget renders the config picker before
    // any LLM call happens. Actions for cancel/preview are bound after the
    // subgraph hands us a real RunHandle.
    let abortFn: () => void = () => {};
    const initialActions: CanvasWidgetActions = {
      cancel: () => abortFn(),
      ...(this.deps.resolvePreviewing !== undefined
        ? {
            resolvePreviewing: (action) => this.deps.resolvePreviewing!(runId, action),
          }
        : {}),
      ...(this.deps.openPreview !== undefined
        ? {
            openPreview: (path: string) => this.deps.openPreview!(path),
          }
        : {}),
    };

    const initialPhase: CanvasViewModel['phase'] =
      this.deps.picker !== undefined ? 'awaiting_config' : 'preparing';
    const controller = new CanvasWidgetController({
      runId,
      threadId: input.threadId,
      op: input.op,
      targetPath,
      originalAsk: input.originalAsk,
      initialViewModel: makeInitialCanvasViewModel({
        runId,
        threadId: input.threadId,
        op: input.op,
        targetPath,
        originalAsk: input.originalAsk,
        phase: initialPhase,
      }),
      actions: initialActions,
    });
    registerCanvasLiveController(runId, controller);
    try {
      this.deps.appendWidgetBlock?.({
        runId,
        threadId: input.threadId,
        op: input.op,
        targetPath,
        originalAsk: input.originalAsk,
      });
    } catch (err) {
      this.deps.logger?.warn?.('canvas.live.append-failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Pre-flight picker — blocks until user confirms or cancels.
    let override: CanvasConfigOverride | null = null;
    if (this.deps.picker !== undefined) {
      const init = this.deps.picker.buildInit({
        originalAsk: input.originalAsk,
        op: input.op,
        targetPath,
      });
      override = await controller.startConfigPhase(this.deps.picker.deps, init);
      if (override === null) {
        controller.setPhase('cancelled');
        releaseCanvasLiveController(runId);
        return { ok: false, cancelledByPicker: true };
      }
      controller.update({ paletteId: override.paletteId });
    }

    // Begin the trace span only after the user has confirmed — avoids a
    // dangling span when the picker is cancelled.
    const traceHandle =
      this.deps.beginTrace?.({
        runId,
        threadId: input.threadId,
        op: input.op,
      }) ?? null;
    const traceConfig: ProviderTraceContext | undefined = traceHandle?.traceConfig;

    const overriddenSubgraph =
      override !== null && this.deps.picker !== undefined
        ? this.deps.picker.applyOverride(this.deps.subgraph, override)
        : this.deps.subgraph;
    const runSubgraph: CanvasSubgraphDeps = {
      ...overriddenSubgraph,
      ...(traceConfig !== undefined ? { traceConfig } : {}),
    };

    const overriddenInput: StartCanvasInput = {
      ...input,
      runId,
      ...(override !== null
        ? {
            targetPath: override.path,
            layoutAlgo: override.preset,
            paletteId: override.paletteId,
          }
        : {}),
    };
    const result = startCanvasRun(runSubgraph, overriddenInput);
    if (!result.ok) {
      // Mutex busy — close any trace span we may have opened, drop the
      // controller we registered.
      if (traceHandle !== null) {
        void Promise.resolve(traceHandle.end()).catch(() => {});
      }
      releaseCanvasLiveController(runId);
      controller.dispose();
      return { ok: false, busy: result.busy };
    }
    const handle = result.handle;
    abortFn = () => handle.abort();
    this.liveHandles.set(handle.runId, handle);

    const unsubscribe = handle.subscribe((event) => {
      const extra: Partial<CanvasViewModel> = {
        ...(event.previewPath !== undefined ? { previewPath: event.previewPath } : {}),
        ...(event.fellBackTo !== undefined ? { fellBackTo: event.fellBackTo } : {}),
        ...(event.insights !== undefined ? { insights: event.insights } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
      };
      controller.setPhase(event.phase, extra);
    });

    const terminal = handle.terminal
      .finally(() => {
        unsubscribe();
        this.liveHandles.delete(handle.runId);
      })
      .finally(() => {
        if (traceHandle !== null) {
          void Promise.resolve(traceHandle.end()).catch((err) => {
            this.deps.logger?.warn?.('canvas.orchestrator.trace.end.failed', {
              runId: handle.runId,
              err: err instanceof Error ? err.message : String(err),
            });
          });
        }
      });

    if (this.deps.persistSnapshot !== undefined) {
      void terminal
        .then((state) => {
          const snapshot = buildCanvasTerminalSnapshot({
            view: this.viewFromTerminal(state, input),
          });
          this.deps.persistSnapshot?.(snapshot);
        })
        .catch((err) => {
          this.deps.logger?.warn?.('canvas.orchestrator.persistSnapshot.failed', {
            runId: handle.runId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }

    return { ok: true, handle, terminal };
  }

  private viewFromTerminal(
    state: CanvasTerminalState,
    input: StartCanvasInput,
  ): ReturnType<typeof makeInitialCanvasViewModel> {
    const base = makeInitialCanvasViewModel({
      runId: state.runId,
      threadId: input.threadId,
      op: state.op,
      targetPath: state.path,
      originalAsk: input.originalAsk,
    });
    return {
      ...base,
      phase: state.phase,
      startedAt: 0,
      endedAt: state.durationMs,
      paletteId: state.paletteId,
      ...(state.insights !== undefined ? { insights: state.insights } : {}),
      ...(state.error !== undefined ? { error: state.error } : {}),
      ...(state.partial?.failedSources !== undefined
        ? { failedSources: state.partial.failedSources }
        : {}),
    };
  }
}

function resolveTargetPath(input: StartCanvasInput): string {
  if (input.targetPath !== undefined && input.targetPath.length > 0) return input.targetPath;
  return defaultCanvasTargetPath(input.originalAsk);
}
