import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { classifyTaskOutputSchema, type ClassifyTaskOutput } from './tools/schemas';
import type { InlineAgentConfig } from './configSchema';
import type { InlineAgentLogger, ProviderFactory } from './index';
import { addTokens, incrementIterations, setRoute, type InlineAgentRunState } from './runState';
import type { BridgeChunk } from './eventBridge';

export interface ToolInventoryItem {
  readonly toolId: string;
  readonly oneLineDescription: string;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  fetch_url: 'HTTP/HTTPS GET/POST against allowlisted hosts; bodies capped.',
  search_web: 'Tavily web search; returns ranked results with optional answer.',
  read_file: 'Read sandbox file with offset/limit; binary base64.',
  write_file: 'Write sandbox file (creates parent dirs); quota-checked.',
  list_dir: 'List sandbox directory entries with type/bytes.',
  delete_file: 'Delete sandbox file or empty dir.',
  publish_artifact: 'Buffer a sandbox file for publication at run end.',
  extract_note: 'Distill a source into a NoteRecord (multistep only).',
};

export function buildToolInventory(config: InlineAgentConfig): ToolInventoryItem[] {
  const inv: ToolInventoryItem[] = [];
  if (config.tools.fetchUrl.enabled) {
    inv.push({ toolId: 'fetch_url', oneLineDescription: TOOL_DESCRIPTIONS.fetch_url! });
  }
  if (config.tools.searchWeb.enabled) {
    inv.push({ toolId: 'search_web', oneLineDescription: TOOL_DESCRIPTIONS.search_web! });
  }
  if (config.tools.fileOps.enabled) {
    inv.push({ toolId: 'read_file', oneLineDescription: TOOL_DESCRIPTIONS.read_file! });
    inv.push({ toolId: 'write_file', oneLineDescription: TOOL_DESCRIPTIONS.write_file! });
    inv.push({ toolId: 'list_dir', oneLineDescription: TOOL_DESCRIPTIONS.list_dir! });
    inv.push({ toolId: 'delete_file', oneLineDescription: TOOL_DESCRIPTIONS.delete_file! });
  }
  inv.push({ toolId: 'publish_artifact', oneLineDescription: TOOL_DESCRIPTIONS.publish_artifact! });
  return inv;
}

export interface ClassifyTaskInput {
  readonly providerFactory: ProviderFactory;
  readonly config: InlineAgentConfig;
  readonly refinedAsk: string;
  readonly signal: AbortSignal;
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLogger;
  readonly emit?: (chunk: BridgeChunk) => void;
  /**
   * Optional override (testing) — bypass providerFactory and use a pre-built
   * ChatModel.
   */
  readonly chatModel?: BaseChatModel;
  readonly now?: () => number;
}

export interface ClassifyTaskNodeResult {
  readonly route: 'simple' | 'multistep';
  readonly reasoning: string;
  readonly initialPlan?: readonly string[];
  readonly fallback?: boolean;
}

const CLASSIFIER_SYSTEM_PROMPT = `You are the inline-agent task router. Decide whether the user's ask is a 'simple' task (one round-trip with built-in tools is enough) or a 'multistep' research task (needs a plan, multiple sources, and a synthesis step). Respond by calling the classify_task tool exactly once. When choosing 'multistep', provide an optional initialPlan with 1..planMaxSteps short sub-questions. Never produce free-text — only the tool call.`;

export async function classifyTask(input: ClassifyTaskInput): Promise<ClassifyTaskNodeResult> {
  const mode = input.config.routing.mode;
  if (mode === 'simple') {
    setRoute(input.runState, 'simple');
    input.emit?.({
      kind: 'node_complete',
      node: 'classify_task',
      durationMs: 0,
      route: 'simple',
    });
    return { route: 'simple', reasoning: 'override:simple' };
  }
  if (mode === 'deep') {
    setRoute(input.runState, 'multistep');
    input.emit?.({
      kind: 'node_complete',
      node: 'classify_task',
      durationMs: 0,
      route: 'multistep',
    });
    return { route: 'multistep', reasoning: 'override:deep' };
  }

  const now = input.now ?? ((): number => Date.now());
  const start = now();
  const planMaxSteps = input.config.planner.planMaxSteps;
  const inventory = buildToolInventory(input.config);
  const userPrompt = buildClassifierUserPrompt(input.refinedAsk, inventory, planMaxSteps);

  const baseModel =
    input.chatModel ??
    input.providerFactory(input.config.providerId, input.config.model, {
      temperature: input.config.temperature,
      signal: input.signal,
    });

  const attempt = async (model: BaseChatModel): Promise<ClassifyTaskOutput> => {
    const structured = (
      model as BaseChatModel & {
        withStructuredOutput?: (
          schema: typeof classifyTaskOutputSchema,
          opts?: { name?: string },
        ) => { invoke: (messages: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown> };
      }
    ).withStructuredOutput;
    if (typeof structured !== 'function') {
      throw new Error('chat model does not support withStructuredOutput');
    }
    const bound = structured.call(model, classifyTaskOutputSchema, { name: 'classify_task' });
    const result = await bound.invoke(
      [new SystemMessage(CLASSIFIER_SYSTEM_PROMPT), new HumanMessage(userPrompt)],
      { signal: input.signal },
    );
    return classifyTaskOutputSchema.parse(result);
  };

  let parsed: ClassifyTaskOutput | null = null;
  let lastError: unknown = null;
  for (let i = 0; i < 2; i += 1) {
    try {
      incrementIterations(input.runState, 1);
      addTokens(input.runState, estimateTokens(input.refinedAsk) + 200);
      const model =
        i === 0
          ? baseModel
          : (input.chatModel ??
            input.providerFactory(input.config.providerId, input.config.model, {
              temperature: 0,
              signal: input.signal,
            }));
      parsed = await attempt(model);
      break;
    } catch (err) {
      lastError = err;
      if (input.signal.aborted) break;
    }
  }

  if (parsed === null) {
    setRoute(input.runState, 'simple');
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    input.logger.warn('externalAgent.adapter.inlineAgent.router.classify-fallback', { reason });
    input.emit?.({
      kind: 'node_complete',
      node: 'classify_task',
      durationMs: now() - start,
      route: 'simple',
    });
    return {
      route: 'simple',
      reasoning: 'classifier_fallback',
      fallback: true,
    };
  }

  const clampedPlan = parsed.initialPlan?.slice(0, planMaxSteps);
  setRoute(input.runState, parsed.route);
  input.emit?.({
    kind: 'node_complete',
    node: 'classify_task',
    durationMs: now() - start,
    route: parsed.route,
    ...(clampedPlan !== undefined ? { planLength: clampedPlan.length } : {}),
  });
  return {
    route: parsed.route,
    reasoning: parsed.reasoning,
    ...(clampedPlan !== undefined && clampedPlan.length > 0 ? { initialPlan: clampedPlan } : {}),
  };
}

function buildClassifierUserPrompt(
  refinedAsk: string,
  inventory: readonly ToolInventoryItem[],
  planMaxSteps: number,
): string {
  const inventoryLines = inventory.map((t) => `- ${t.toolId}: ${t.oneLineDescription}`).join('\n');
  return [
    'Refined ask:',
    refinedAsk,
    '',
    'Runtime tool inventory (post enabled-filter):',
    inventoryLines,
    '',
    `planMaxSteps = ${planMaxSteps}`,
    '',
    "Decide route via the classify_task tool. Use 'multistep' only if multiple sources or a synthesis step are required.",
  ].join('\n');
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
