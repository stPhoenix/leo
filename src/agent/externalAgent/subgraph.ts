import type { Logger } from '@/platform/Logger';
import type { ExternalAgentAdapter, ExternalEvent } from './adapters/base';
import {
  applyExternalEvent,
  type ExternalAgentState,
  type ExternalPhase,
  type RefineMessage,
  initialState,
  isTerminal,
} from './state';

export interface RefineDecision {
  readonly type: 'final_prompt' | 'clarify' | 'budget_exhausted';
  readonly text: string;
  readonly refinedPrompt?: string;
  readonly assistantMessage?: RefineMessage;
}

export interface RefineDeps {
  refine(input: {
    readonly state: ExternalAgentState;
    readonly userInput: string | null;
    readonly signal: AbortSignal;
  }): Promise<RefineDecision>;
}

export interface AdapterCallDeps {
  start(input: {
    readonly adapter: ExternalAgentAdapter;
    readonly refinedAsk: string;
    readonly systemPrompt: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly config: unknown;
    readonly runId: string;
    readonly threadId?: string;
  }): AsyncIterable<ExternalEvent>;
}

export interface WriterDeps {
  write(input: {
    readonly state: ExternalAgentState;
    readonly status: 'done' | 'error';
  }): Promise<{ folder: string; writtenFiles: readonly string[]; ok: boolean }>;
}

export interface AdapterRegistryView {
  get(id: string): ExternalAgentAdapter | undefined;
}

export interface SubgraphDeps {
  readonly refine: RefineDeps;
  readonly adapterCall: AdapterCallDeps;
  readonly writer: WriterDeps;
  readonly registry: AdapterRegistryView;
  readonly systemPrompt: string;
  readonly logger?: Logger;
  readonly now?: () => number;
  /**
   * After the abort signal fires, wait at most this long for the adapter
   * iterator to terminate before transitioning to ERROR with
   * `error.code='abort_timeout'`. Defaults to 2_000 ms (NFR-EXT-01).
   */
  readonly abortGraceMs?: number;
}

export type StateListener = (state: ExternalAgentState) => void;

export interface ClarifyResume {
  readonly answer: string;
}

export interface ReadyAction {
  readonly type: 'send' | 'edit' | 'cancel';
  readonly editedPrompt?: string;
  readonly adapterId?: string;
  readonly timeoutMs?: number;
  readonly refineBudget?: number;
}

export interface RunHandle {
  readonly runId: string;
  readonly threadId: string;
  state(): ExternalAgentState;
  subscribe(listener: StateListener): () => void;
  resumeClarify(input: ClarifyResume): void;
  applyReadyAction(action: ReadyAction): void;
  cancel(): void;
  done(): Promise<ExternalAgentState>;
}

export interface RunInput {
  readonly runId: string;
  readonly threadId: string;
  readonly originalAsk: string;
  readonly refineBudget?: number;
  readonly timeoutMs?: number;
  readonly selectedAdapterId?: string | null;
  readonly resolvedConfig?: unknown;
}

// Hand-rolled FSM driver instead of LangGraph `entrypoint()` + `interrupt()`. The
// LangGraph functional API re-runs the entrypoint callback from start on every
// `Command({ resume })`, with previous `task()` results memoized and `interrupt()`
// returning the resume value on replay. That model conflicts with two load-bearing
// invariants here:
//   1. Mid-execution `setState` mutations (per-event textBuffer, per-phase
//      transitionTo) drive the per-mutation `StateListener` fan-out the widget UI
//      subscribes to. Replays would re-fire listeners for already-emitted phases.
//   2. Closure-captured `state` accumulates between user-input gates (clarify,
//      ready). Re-running pre-interrupt code on resume either re-applies mutations
//      (e.g. refineIterations doubles) or loses them (if cleared on re-init).
// JS-native Promise + AbortSignal continuations are the correct framework
// primitive at this seam — `clarifyResolver` / `readyResolver` are equivalent to
// `interrupt()` semantically without the replay penalty.
export function startExternalAgentRun(deps: SubgraphDeps, input: RunInput): RunHandle {
  const now = deps.now ?? ((): number => Date.now());
  const refineBudget = input.refineBudget ?? 3;
  const initialAdapterId = input.selectedAdapterId ?? null;
  const initialTimeoutMs = input.timeoutMs ?? defaultTimeoutFor(deps.registry, initialAdapterId);
  const resolvedConfig = input.resolvedConfig;

  let state: ExternalAgentState = initialState({
    runId: input.runId,
    threadId: input.threadId,
    originalAsk: input.originalAsk,
    refineBudget,
    selectedAdapterId: initialAdapterId,
    timeoutMs: initialTimeoutMs,
  });

  const listeners = new Set<StateListener>();
  const cancelController = new AbortController();
  let readyResolver: ((action: ReadyAction) => void) | null = null;
  let clarifyResolver: ((answer: string | null) => void) | null = null;
  let terminalResolve: (s: ExternalAgentState) => void;
  const terminalPromise = new Promise<ExternalAgentState>((res) => {
    terminalResolve = res;
  });

  const setState = (next: ExternalAgentState): void => {
    if (state === next) return;
    state = next;
    for (const l of listeners) {
      try {
        l(state);
      } catch (err) {
        deps.logger?.warn('externalAgent.subgraph.listener-failed', {
          error: err instanceof Error ? err.message : String(err),
          runId: state.runId,
        });
      }
    }
    if (isTerminal(state.phase)) terminalResolve(state);
  };

  const transitionTo = (next: ExternalPhase, patch: Partial<ExternalAgentState> = {}): void => {
    if (isTerminal(state.phase)) return;
    setState({ ...state, ...patch, phase: next });
    deps.logger?.debug('externalAgent.subgraph.transition', {
      runId: state.runId,
      threadId: state.threadId,
      phase: next,
    });
  };

  const finishWithError = async (code: string, message: string): Promise<void> => {
    if (isTerminal(state.phase)) return;
    transitionTo('writing', { error: { code, message }, endedAt: state.endedAt ?? now() });
    let folder: string | null = null;
    let writtenFiles: readonly string[] = [];
    try {
      const result = await deps.writer.write({ state, status: 'error' });
      folder = result.folder;
      writtenFiles = result.writtenFiles;
    } catch (err) {
      deps.logger?.warn('externalAgent.subgraph.write-error-md-failed', {
        runId: state.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    transitionTo('error', {
      error: { code, message },
      resultFolder: folder,
      writtenFiles,
      endedAt: state.endedAt ?? now(),
    });
  };

  const finishCancelled = (phaseAtCancel: ExternalPhase): void => {
    if (isTerminal(state.phase)) return;
    deps.logger?.info('externalAgent.subgraph.cancelled', {
      runId: state.runId,
      cancelledFrom: phaseAtCancel,
    });
    transitionTo('cancelled', { endedAt: state.endedAt ?? now() });
  };

  const awaitClarifyAnswer = (): Promise<string | null> =>
    new Promise<string | null>((resolve) => {
      if (cancelController.signal.aborted) {
        resolve(null);
        return;
      }
      clarifyResolver = (a) => {
        clarifyResolver = null;
        resolve(a);
      };
      cancelController.signal.addEventListener(
        'abort',
        () => {
          if (clarifyResolver !== null) {
            clarifyResolver = null;
            resolve(null);
          }
        },
        { once: true },
      );
    });

  const awaitReadyAction = (): Promise<ReadyAction | null> =>
    new Promise<ReadyAction | null>((resolve) => {
      if (cancelController.signal.aborted) {
        resolve(null);
        return;
      }
      readyResolver = (a) => {
        readyResolver = null;
        resolve(a);
      };
      cancelController.signal.addEventListener(
        'abort',
        () => {
          if (readyResolver !== null) {
            readyResolver = null;
            resolve(null);
          }
        },
        { once: true },
      );
    });

  const runRefineLoop = async (initialUserInput: string | null): Promise<boolean> => {
    let userInput = initialUserInput;
    while (!isTerminal(state.phase)) {
      if (cancelController.signal.aborted) {
        finishCancelled('preparing');
        return false;
      }
      if (state.refineIterations >= state.refineBudget) {
        const draft = state.refinedPrompt ?? state.originalAsk;
        transitionTo('ready', { refinedPrompt: draft });
        return true;
      }
      let decision: RefineDecision;
      try {
        const refineCall = deps.refine.refine({
          state,
          userInput,
          signal: cancelController.signal,
        });
        const abortObserver = waitForAbort(cancelController.signal);
        const winner = await Promise.race([
          refineCall.then((d) => ({ kind: 'decision' as const, d })),
          abortObserver.promise.then(() => ({ kind: 'aborted' as const })),
        ]);
        abortObserver.cancel();
        if (winner.kind === 'aborted') {
          finishCancelled('preparing');
          return false;
        }
        decision = winner.d;
      } catch (err) {
        if (cancelController.signal.aborted) {
          finishCancelled('preparing');
          return false;
        }
        await finishWithError('refine_failed', err instanceof Error ? err.message : String(err));
        return false;
      }
      userInput = null;
      const nextHistory: RefineMessage[] = [
        ...state.refineHistory,
        ...(decision.assistantMessage !== undefined ? [decision.assistantMessage] : []),
      ];
      const nextIter = state.refineIterations + 1;
      if (decision.type === 'final_prompt' || decision.type === 'budget_exhausted') {
        const finalPrompt = decision.refinedPrompt ?? decision.text;
        setState({
          ...state,
          refineHistory: nextHistory,
          refineIterations: nextIter,
          refinedPrompt: finalPrompt,
        });
        transitionTo('ready', { refinedPrompt: finalPrompt });
        return true;
      }
      // clarify
      const question = decision.text;
      setState({
        ...state,
        refineHistory: nextHistory,
        refineIterations: nextIter,
        clarifyingQuestion: question,
      });
      transitionTo('awaiting_clarify');
      const answer = await awaitClarifyAnswer();
      if (answer === null) {
        finishCancelled('awaiting_clarify');
        return false;
      }
      userInput = answer;
      setState({
        ...state,
        refineHistory: [...state.refineHistory, { role: 'user', content: answer }],
        clarifyingQuestion: null,
      });
      transitionTo('preparing');
    }
    return false;
  };

  const runAdapterPhase = async (adapter: ExternalAgentAdapter): Promise<void> => {
    const startedAt = now();
    transitionTo('running', { startedAt, endedAt: null });

    const adapterAbort = new AbortController();
    const timeoutMs = state.timeoutMs;
    let timedOut = false;
    let abortTimedOut = false;
    const adapterRunStartedAt = now();
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            deps.logger?.warn('externalAgent.subgraph.adapterAbort.fire', {
              runId: state.runId,
              source: 'timeout',
              timeoutMs,
              elapsedMs: now() - adapterRunStartedAt,
            });
            adapterAbort.abort();
          }, timeoutMs)
        : null;
    const onCancel = (): void => {
      deps.logger?.warn('externalAgent.subgraph.adapterAbort.fire', {
        runId: state.runId,
        source: 'cancelController',
        elapsedMs: now() - adapterRunStartedAt,
      });
      adapterAbort.abort();
    };
    cancelController.signal.addEventListener('abort', onCancel, { once: true });

    let adapterError: { code: string; message: string } | null = null;
    let adapterDone = false;
    let postDoneEventCount = 0;
    let iterator: AsyncIterator<ExternalEvent> | null = null;

    try {
      const cfg =
        resolvedConfig !== undefined ? await Promise.resolve(resolvedConfig) : pickConfig(adapter);
      const stream = deps.adapterCall.start({
        adapter,
        refinedAsk: state.refinedPrompt ?? state.originalAsk,
        systemPrompt: deps.systemPrompt,
        signal: adapterAbort.signal,
        timeoutMs,
        config: cfg,
        runId: state.runId,
        threadId: state.threadId,
      });
      iterator = stream[Symbol.asyncIterator]();
      const graceMs = deps.abortGraceMs ?? 2_000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const nextStep = iterator.next();
        let step: IteratorResult<ExternalEvent>;
        // Always race against an abort observer so a hanging next() can be
        // surfaced as `abort_timeout` once cancel/timeout fires.
        const abortObserver = waitForAbort(adapterAbort.signal);
        const winner = await Promise.race([
          nextStep.then((s) => ({ kind: 'next' as const, step: s })),
          abortObserver.promise.then(() => ({ kind: 'aborted' as const })),
        ]);
        abortObserver.cancel();
        if (winner.kind === 'aborted') {
          // Adapter still hasn't yielded after abort; give it a grace window.
          const grace = abortTimeout(graceMs);
          const after = await Promise.race([
            nextStep.then((s) => ({ kind: 'next' as const, step: s })),
            grace.promise.then(() => ({ kind: 'abort_timeout' as const })),
          ]);
          grace.cancel();
          if (after.kind === 'abort_timeout') {
            abortTimedOut = true;
            break;
          }
          step = after.step;
        } else {
          step = winner.step;
        }
        if (step.done === true) break;
        const event = step.value;
        if (adapterDone) {
          postDoneEventCount += 1;
          continue;
        }
        setState(applyExternalEvent(state, event, { ts: now }));
        if (event.type === 'error') {
          adapterError = event.error;
          break;
        }
        if (event.type === 'done') {
          adapterDone = true;
          // Continue draining briefly in case the adapter emits a tiny tail
          // (we don't transition until iterator closes or aborts).
          break;
        }
      }
    } catch (err) {
      adapterError = {
        code: 'adapter_throw',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
      cancelController.signal.removeEventListener('abort', onCancel);
      if (iterator !== null && typeof iterator.return === 'function') {
        try {
          await iterator.return();
        } catch {
          /* iterator return failure is non-fatal */
        }
      }
    }

    if (postDoneEventCount > 0) {
      deps.logger?.warn('externalAgent.run.events-after-done', {
        runId: state.runId,
        adapterId: adapter.id,
        count: postDoneEventCount,
      });
    }

    if (abortTimedOut) {
      await finishWithError(
        'abort_timeout',
        `Adapter ${adapter.id} did not respect AbortSignal within grace window`,
      );
      return;
    }
    if (cancelController.signal.aborted && !timedOut) {
      finishCancelled('running');
      return;
    }
    if (timedOut) {
      await finishWithError('timeout', `Adapter ${adapter.id} exceeded ${timeoutMs}ms`);
      return;
    }
    if (adapterError !== null) {
      await finishWithError(adapterError.code, adapterError.message);
      return;
    }
    if (!adapterDone) {
      await finishWithError('adapter_no_done', `Adapter ${adapter.id} ended without 'done' event`);
      return;
    }

    const endedAt = now();
    transitionTo('writing', { endedAt });
    try {
      const result = await deps.writer.write({ state, status: 'done' });
      if (!result.ok) {
        transitionTo('error', {
          error: { code: 'write_failed', message: 'ResultWriter reported failure' },
          resultFolder: result.folder,
          writtenFiles: result.writtenFiles,
          endedAt: state.endedAt ?? now(),
        });
        return;
      }
      transitionTo('done', {
        resultFolder: result.folder,
        writtenFiles: result.writtenFiles,
        endedAt: state.endedAt ?? now(),
      });
    } catch (err) {
      await finishWithError('write_failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handle: RunHandle = {
    runId: input.runId,
    threadId: input.threadId,
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resumeClarify: (resume) => {
      const fn = clarifyResolver;
      if (fn === null) return;
      fn(resume.answer);
    },
    applyReadyAction: (action) => {
      const fn = readyResolver;
      if (fn === null) return;
      fn(action);
    },
    cancel: () => {
      if (cancelController.signal.aborted || isTerminal(state.phase)) {
        deps.logger?.info('externalAgent.subgraph.cancel.noop', {
          runId: state.runId,
          alreadyAborted: cancelController.signal.aborted,
          phase: state.phase,
        });
        return;
      }
      const stack = new Error('cancel-callsite').stack ?? '';
      deps.logger?.warn('externalAgent.subgraph.cancel.invoked', {
        runId: state.runId,
        threadId: state.threadId,
        phase: state.phase,
        stack: stack.split('\n').slice(0, 8).join('\n'),
      });
      cancelController.abort();
    },
    done: () => terminalPromise,
  };

  void (async (): Promise<void> => {
    try {
      let userInput: string | null = null;
      while (!isTerminal(state.phase)) {
        const reachedReady = await runRefineLoop(userInput);
        userInput = null;
        if (!reachedReady || isTerminal(state.phase)) return;
        const action = await awaitReadyAction();
        if (action === null) {
          finishCancelled('ready');
          return;
        }
        if (action.type === 'cancel') {
          finishCancelled('ready');
          return;
        }
        if (action.type === 'edit') {
          const edited = action.editedPrompt ?? '';
          setState({
            ...state,
            refineHistory: [...state.refineHistory, { role: 'user', content: edited }],
          });
          transitionTo('preparing');
          userInput = edited;
          continue;
        }
        // send
        const adapterId = action.adapterId ?? state.selectedAdapterId;
        const timeoutMs = action.timeoutMs ?? state.timeoutMs;
        if (adapterId === null || adapterId === undefined) {
          await finishWithError('adapter_missing', 'No adapter selected and no default available.');
          return;
        }
        const adapter = deps.registry.get(adapterId);
        if (adapter === undefined) {
          await finishWithError('adapter_missing', `Adapter not registered: ${adapterId}`);
          return;
        }
        setState({
          ...state,
          selectedAdapterId: adapterId,
          timeoutMs,
          ...(action.refineBudget !== undefined ? { refineBudget: action.refineBudget } : {}),
        });
        await runAdapterPhase(adapter);
        return;
      }
    } catch (err) {
      deps.logger?.error('externalAgent.subgraph.unhandled', {
        runId: state.runId,
        error: err instanceof Error ? err.message : String(err),
      });
      await finishWithError('subgraph_throw', err instanceof Error ? err.message : String(err));
    }
  })();

  return handle;
}

function defaultTimeoutFor(registry: AdapterRegistryView, adapterId: string | null): number {
  if (adapterId === null) return 0;
  const adapter = registry.get(adapterId);
  return adapter?.defaultTimeoutMs ?? 0;
}

function pickConfig(adapter: ExternalAgentAdapter): unknown {
  try {
    return adapter.configSchema.parse({});
  } catch {
    return {};
  }
}

interface AbortTimer {
  readonly promise: Promise<void>;
  cancel(): void;
}

function waitForAbort(signal: AbortSignal): AbortTimer {
  if (signal.aborted) {
    return { promise: Promise.resolve(), cancel: () => undefined };
  }
  let resolveFn: (() => void) | null = null;
  const onAbort = (): void => {
    if (resolveFn !== null) resolveFn();
  };
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    cancel(): void {
      signal.removeEventListener('abort', onAbort);
      const r = resolveFn;
      resolveFn = null;
      if (r !== null) r();
    },
  };
}

function abortTimeout(ms: number): AbortTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveFn: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
    timer = setTimeout(() => resolve(), ms);
  });
  return {
    promise,
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // Allow the promise to settle as a no-op if the racer abandoned it.
      const r = resolveFn;
      if (r !== null) r();
    },
  };
}
