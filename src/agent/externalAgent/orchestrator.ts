import type { Logger } from '@/platform/Logger';
import type { AdapterRegistry } from './adapterRegistry';
import { generateRunId } from './runId';
import type { SlotManager } from './slotManager';
import { buildTerminalSnapshot, type ExternalAgentTerminalSnapshot } from './terminalSnapshot';
import {
  startExternalAgentRun,
  type AdapterCallDeps,
  type BeginExternalAgentTrace,
  type RefineDeps,
  type RunHandle,
  type SubgraphDeps,
  type WriterDeps,
} from './subgraph';
import { buildToolResult, type DelegateExternalToolResult } from './runPhase';
import type { ExternalAgentState, ExternalPhase } from './state';

export interface OrchestratorDeps {
  readonly registry: AdapterRegistry;
  readonly slots: SlotManager;
  readonly refine: RefineDeps;
  readonly adapterCall: AdapterCallDeps;
  readonly writer: WriterDeps;
  readonly systemPrompt: string;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly defaultRefineBudget?: number;
  readonly abortGraceMs?: number;
  readonly onHandle?: (handle: RunHandle) => void;
  /**
   * Resolve the configured config blob for an adapter (already passed through
   * `safeStorage:` indirection). Used to compose the persisted terminal
   * snapshot's `adapterConfigSnapshot` (with secret fields dropped).
   */
  readonly resolveConfig?: (adapterId: string) => Promise<unknown>;
  /**
   * Persist the terminal snapshot into the chat thread. Called once per run
   * after the subgraph reaches a terminal state.
   */
  readonly persistSnapshot?: (snapshot: ExternalAgentTerminalSnapshot) => void;
  /**
   * Optional Langfuse trace factory; forwarded to the subgraph so refine LLM
   * generations are nested under the caller's parent span.
   */
  readonly beginTrace?: BeginExternalAgentTrace;
}

export type DelegationStartResult =
  | {
      readonly ok: true;
      readonly handle: RunHandle;
      readonly terminal: Promise<DelegateExternalToolResult>;
    }
  | {
      readonly ok: false;
      readonly busy: true;
      readonly activeRunId: string;
    };

export class ExternalAgentOrchestrator {
  private readonly liveHandles = new Map<string, RunHandle>();

  constructor(private readonly deps: OrchestratorDeps) {}

  findHandle(runId: string): RunHandle | null {
    return this.liveHandles.get(runId) ?? null;
  }

  liveHandlesSnapshot(): readonly RunHandle[] {
    return [...this.liveHandles.values()];
  }

  start(input: {
    readonly threadId: string;
    readonly originalAsk: string;
    readonly refineBudget?: number;
    readonly timeoutMs?: number;
  }): DelegationStartResult {
    const runId = generateRunId();
    const acquire = this.deps.slots.acquire(input.threadId, runId);
    if (acquire.busy) {
      return { ok: false, busy: true, activeRunId: acquire.activeRunId };
    }
    const slotHandle = acquire.handle;
    const subgraphDeps: SubgraphDeps = {
      refine: this.deps.refine,
      adapterCall: this.deps.adapterCall,
      writer: this.deps.writer,
      registry: this.deps.registry,
      systemPrompt: this.deps.systemPrompt,
      ...(this.deps.logger !== undefined ? { logger: this.deps.logger } : {}),
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
      ...(this.deps.abortGraceMs !== undefined ? { abortGraceMs: this.deps.abortGraceMs } : {}),
      ...(this.deps.beginTrace !== undefined ? { beginTrace: this.deps.beginTrace } : {}),
    };

    const adapterId = this.deps.registry.defaultId() ?? null;

    // Resolve adapter config once at run-start so the user's stored config
    // (decrypted safeStorage refs included) reaches the adapter on its first
    // call. Reused for the terminal-snapshot persist below — same Promise,
    // awaited twice, no double resolution.
    const resolvedConfigPromise: Promise<unknown> =
      adapterId !== null && this.deps.resolveConfig !== undefined
        ? this.deps.resolveConfig(adapterId).catch(() => ({}))
        : Promise.resolve({});

    const handle = startExternalAgentRun(subgraphDeps, {
      runId,
      threadId: input.threadId,
      originalAsk: input.originalAsk,
      refineBudget: input.refineBudget ?? this.deps.defaultRefineBudget ?? 3,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      selectedAdapterId: adapterId,
      resolvedConfig: resolvedConfigPromise,
    });

    this.liveHandles.set(runId, handle);
    this.deps.onHandle?.(handle);

    let lastNonTerminalPhase: ExternalPhase = 'preparing';
    const phaseUnsub = handle.subscribe((state: ExternalAgentState) => {
      if (
        state.phase === 'preparing' ||
        state.phase === 'awaiting_clarify' ||
        state.phase === 'ready' ||
        state.phase === 'running' ||
        state.phase === 'writing'
      ) {
        lastNonTerminalPhase = state.phase;
      }
    });

    const terminal = handle.done().then(async (finalState) => {
      phaseUnsub();
      slotHandle.release();
      this.liveHandles.delete(runId);
      const cancelledFrom = pickCancelPhase(lastNonTerminalPhase);
      try {
        if (this.deps.persistSnapshot !== undefined) {
          const finalAdapterId = finalState.selectedAdapterId ?? '';
          // Reuse run-start resolution when the adapter is unchanged; otherwise
          // resolve fresh for the snapshot's actual adapter.
          let resolvedConfig: unknown;
          if (finalAdapterId === (adapterId ?? '')) {
            resolvedConfig = await resolvedConfigPromise;
          } else if (this.deps.resolveConfig !== undefined) {
            resolvedConfig = await this.deps.resolveConfig(finalAdapterId).catch(() => ({}));
          } else {
            resolvedConfig = {};
          }
          const snapshot = buildTerminalSnapshot({
            state: finalState,
            registry: this.deps.registry,
            resolvedConfig,
            cancelledFromPhase: finalState.phase === 'cancelled' ? cancelledFrom : undefined,
          });
          this.deps.persistSnapshot(snapshot);
        }
      } catch (err) {
        this.deps.logger?.warn('externalAgent.persist.failed', {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return buildToolResult(finalState, cancelledFrom);
    });

    return { ok: true, handle, terminal };
  }
}

function pickCancelPhase(
  phase: ExternalPhase,
): 'ready' | 'running' | 'preparing' | 'awaiting_clarify' {
  if (phase === 'running') return 'running';
  if (phase === 'ready') return 'ready';
  if (phase === 'awaiting_clarify') return 'awaiting_clarify';
  return 'preparing';
}
