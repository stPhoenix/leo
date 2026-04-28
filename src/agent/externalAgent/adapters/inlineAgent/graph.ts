import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ExternalEvent } from '../base';
import type { InlineAgentLogger, ProviderFactory } from './index';
import { resolveSystemPrompt } from './index';
import { inlineAgentConfigSchema, type InlineAgentConfig } from './configSchema';
import { Sandbox } from './sandbox';
import { createInitialRunState, setPlan } from './runState';
import { composeAbortSignal, perStepBudget, selectMaxIterations } from './budgets';
import { bridgeStream, mapAdapterError, mapNodeComplete } from './eventBridge';
import { classifyTask } from './router';
import { buildSimpleBranchTools, runManualLoop, type ReactLoopCtx } from './branches/simpleBranch';
import { planSteps } from './multistep/planner';
import {
  buildResearchStepTools,
  runManualResearchLoop,
  type ManualChatModelAdapter,
} from './multistep/researchStep';
import {
  buildSynthesizeTools,
  buildSynthesizePrompt,
  runManualSynthesizeLoop,
  selectSynthesizeIterations,
} from './multistep/synthesize';
import {
  dropRawToolMessagesAtStepBoundary,
  type RewriteMessage,
} from './multistep/messageRewriter';
import { flushPublishedArtifacts } from './artifactFlush';

export interface InlineAgentGraphDeps {
  readonly providerFactory: ProviderFactory;
  readonly logger: InlineAgentLogger;
  /** Optional override: convert a BaseChatModel into a ManualChatModelAdapter. */
  readonly chatModelAdapter?: (model: BaseChatModel) => ManualChatModelAdapter;
  /** Optional override of the wall-clock signal helper for tests. */
  readonly composeSignal?: typeof composeAbortSignal;
  /** Optional resolved Tavily api key (already walked from safeStorage:). */
  readonly resolveSearchWebApiKey?: (config: InlineAgentConfig) => string;
}

export interface InlineAgentGraphInput {
  readonly refinedAsk: string;
  readonly systemPrompt: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly config: unknown;
  readonly runId: string;
}

export const FORBIDDEN_TOOL_NAMES: readonly string[] = ['delegate_external'];

export function assertNoExternalDelegate(
  toolLists: readonly {
    readonly branch: string;
    readonly tools: readonly { readonly name: string }[];
  }[],
): void {
  for (const list of toolLists) {
    for (const tool of list.tools) {
      if (FORBIDDEN_TOOL_NAMES.includes(tool.name)) {
        throw new Error(
          `recursion_guard_violation: branch '${list.branch}' contains forbidden tool '${tool.name}'`,
        );
      }
    }
  }
}

export async function* runInlineAgentGraph(
  deps: InlineAgentGraphDeps,
  input: InlineAgentGraphInput,
): AsyncIterable<ExternalEvent> {
  let parsed: InlineAgentConfig;
  try {
    parsed = inlineAgentConfigSchema.parse(input.config ?? {});
  } catch (err) {
    yield mapAdapterError({
      code: 'invalid_config',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const compose = deps.composeSignal ?? composeAbortSignal;
  const wallClockMs = Math.max(1, parsed.budgets.wallClockMs);
  const composed = compose(input.signal, Math.min(input.timeoutMs || wallClockMs, wallClockMs));

  const sandbox = new Sandbox({
    runId: input.runId,
    logger: deps.logger,
    quotaBytes: parsed.sandbox.quotaBytes,
  });
  const runState = createInitialRunState({
    runId: input.runId,
    sandboxRoot: sandbox.root,
    routingMode: parsed.routing.mode,
    startedAt: Date.now(),
  });

  try {
    const initResult = await sandbox.init();
    if (!initResult.ok) {
      yield mapAdapterError({
        code: initResult.error,
        message: initResult.cause ?? 'sandbox initialization failed',
      });
      return;
    }

    const searchWebApiKey =
      deps.resolveSearchWebApiKey?.(parsed) ?? parsed.tools.searchWeb.apiKeyRef ?? '';

    // Recursion-guard pre-check on tool-list assembly.
    const simpleTools = buildSimpleBranchTools({
      config: parsed,
      sandbox,
      runState,
      logger: deps.logger,
      signal: composed.signal,
      searchWebApiKey,
    });
    const researchTools = buildResearchStepTools({
      config: parsed,
      sandbox,
      runState,
      logger: deps.logger,
      signal: composed.signal,
      searchWebApiKey,
    });
    const synthTools = buildSynthesizeTools({
      config: parsed,
      sandbox,
      runState,
      logger: deps.logger,
    });
    try {
      assertNoExternalDelegate([
        { branch: 'simple', tools: simpleTools },
        { branch: 'researchStep', tools: researchTools },
        { branch: 'synthesize', tools: synthTools },
      ]);
    } catch (err) {
      yield mapAdapterError({
        code: 'recursion_guard_violation',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const composedSystemPrompt = resolveSystemPrompt({
      hostPrompt: input.systemPrompt,
      override: null,
    });

    const chatModel = (() => {
      try {
        return deps.providerFactory(parsed.providerId, parsed.model, {
          temperature: parsed.temperature,
          signal: composed.signal,
        });
      } catch {
        return null;
      }
    })();
    if (chatModel === null) {
      yield mapAdapterError({
        code: 'invalid_provider',
        message: `providerFactory failed for ${parsed.providerId}/${parsed.model}`,
      });
      return;
    }

    const manualAdapter =
      deps.chatModelAdapter !== undefined
        ? deps.chatModelAdapter(chatModel)
        : ((chatModel as unknown as { manualAdapter?: ManualChatModelAdapter }).manualAdapter ??
          null);
    if (manualAdapter === null) {
      yield mapAdapterError({
        code: 'invalid_provider',
        message: 'inline agent requires a ManualChatModelAdapter (set deps.chatModelAdapter)',
      });
      return;
    }

    // Phase 1 — classify
    const classifier = await classifyTask({
      providerFactory: deps.providerFactory,
      config: parsed,
      refinedAsk: input.refinedAsk,
      signal: composed.signal,
      runState,
      logger: deps.logger,
      chatModel,
    });
    yield mapNodeComplete({
      node: 'classify_task',
      durationMs: 0,
      route: classifier.route,
      ...(classifier.initialPlan !== undefined
        ? { planLength: classifier.initialPlan.length }
        : {}),
    });

    let route = classifier.route;
    let plan: readonly string[] = [];

    if (route === 'multistep') {
      const planResult = await planSteps({
        providerFactory: deps.providerFactory,
        config: parsed,
        refinedAsk: input.refinedAsk,
        ...(classifier.initialPlan !== undefined ? { initialPlan: classifier.initialPlan } : {}),
        signal: composed.signal,
        runState,
        logger: deps.logger,
        chatModel,
      });
      if (planResult.ok) {
        plan = planResult.plan;
        setPlan(runState, plan);
        yield mapNodeComplete({
          node: 'planner',
          durationMs: 0,
          planLength: plan.length,
        });
      } else {
        // planner.ts already logs warn on `unparsable`/`llm_error`; only the
        // `empty` reason needs an additional warn here.
        if (planResult.reason === 'empty') {
          deps.logger.warn('externalAgent.adapter.inlineAgent.multistep.planner-fallback', {
            reason: planResult.reason,
          });
        }
        route = 'simple';
      }
    }

    // Phase 2 — branch execution
    let deferredError: ExternalEvent | null = null;
    if (route === 'simple') {
      const cap = selectMaxIterations('simple', parsed.budgets);
      const remaining = Math.max(0, cap - runState.iterations);
      const loopCtx: ReactLoopCtx = {
        chatModel,
        tools: simpleTools,
        maxIterations: remaining,
        signal: composed.signal,
        refinedAsk: input.refinedAsk,
        systemPrompt: composedSystemPrompt,
        runState,
        logger: deps.logger,
        tokenLimit: parsed.budgets.maxTokens,
      };
      for await (const ev of bridgeStream(runManualLoop(loopCtx, manualAdapter), {
        logger: deps.logger,
      })) {
        if (ev.type === 'error') {
          deferredError = ev;
          break;
        }
        if (ev.type === 'done') break;
        yield ev;
      }
    } else {
      const cap = selectMaxIterations('multistep', parsed.budgets);
      let messagesCarried: readonly RewriteMessage[] = [
        { role: 'system', content: composedSystemPrompt },
        { role: 'user', content: input.refinedAsk },
      ];
      const remainingSteps = plan.length;
      for (let i = 0; i < remainingSteps; i += 1) {
        runState.currentStep = i;
        const remainingIterations = Math.max(0, cap - runState.iterations);
        const remaining = remainingSteps - i;
        const stepBudget = perStepBudget({
          remainingIterations,
          remainingSteps: remaining,
        });
        if (stepBudget <= 0 || composed.signal.aborted) break;
        const stepTools = researchTools;
        const generator = runManualResearchLoop(
          {
            tools: stepTools,
            maxIterations: stepBudget,
            signal: composed.signal,
            runState,
            logger: deps.logger,
            planStep: plan[i] ?? '',
            stepIndex: i,
            tokenLimit: parsed.budgets.maxTokens,
            messages: messagesCarried,
          },
          manualAdapter,
        );
        let aborted = false;
        for await (const ev of bridgeStream(generator, { logger: deps.logger })) {
          if (ev.type === 'error') {
            const code = ev.error.code;
            if (code === 'iteration_limit') {
              // Step-level cap; advance.
              break;
            }
            if (code === 'token_limit') {
              yield ev;
              return;
            }
            yield ev;
            aborted = true;
            break;
          }
          if (ev.type === 'done') break;
          yield ev;
        }
        if (aborted) return;
        messagesCarried = dropRawToolMessagesAtStepBoundary(messagesCarried);
      }

      const remainingIterations = Math.max(0, cap - runState.iterations);
      const synthMax = selectSynthesizeIterations(remainingIterations);
      const synthMessages: readonly RewriteMessage[] = [
        {
          role: 'system',
          content:
            'You are the inline-agent synthesizer. Use only the notes; do not call any tool other than publish_artifact.',
        },
        {
          role: 'user',
          content: buildSynthesizePrompt({
            refinedAsk: input.refinedAsk,
            plan,
            notes: runState.notes,
            scratchpad: runState.scratchpad,
          }),
        },
      ];
      const synthGen = runManualSynthesizeLoop(
        {
          tools: synthTools,
          maxIterations: synthMax,
          signal: composed.signal,
          runState,
          logger: deps.logger,
          tokenLimit: parsed.budgets.maxTokens,
          messages: synthMessages,
        },
        manualAdapter,
      );
      for await (const ev of bridgeStream(synthGen, { logger: deps.logger })) {
        if (ev.type === 'error') {
          deferredError = ev;
          break;
        }
        if (ev.type === 'done') break;
        yield ev;
      }
    }

    // Phase 3 — flush artifacts (partial-flush on error path is intentional;
    // FR-IA-36 keeps prior nominations even when the branch terminated with
    // `iteration_limit`).
    yield* flushPublishedArtifacts({ runState, sandbox, logger: deps.logger });
    if (deferredError !== null) {
      yield deferredError;
      return;
    }
    yield { type: 'done' };
  } catch (err) {
    yield mapAdapterError(err);
  } finally {
    composed.cancel();
    await sandbox.cleanup();
  }
}
