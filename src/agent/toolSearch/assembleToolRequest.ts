import type { ProviderKind, ToolSearchSettings } from '@/settings/settingsStore';
import type { OpenAITool, ProviderHints } from '@/providers/types';
import type { ToolRegistry } from '@/tools/toolRegistry';
import type { ToolSpec } from '@/tools/types';
import type { ContentBlock } from '@/chat/types';
import { partitionTools } from '@/tools/toolSearch/deferralRules';
import {
  extractDiscoveredToolNamesFromHistory,
  mergeDiscovered,
} from '@/tools/toolSearch/discovery';
import { formatDeferredAnnouncement } from '@/tools/toolSearch/announcement';
import { TOOL_SEARCH_TOOL_ID } from '@/tools/toolSearch/toolSearchTool';
import { isNativeDeferralSupported, isToolSearchEnabled } from './modelGating';

export const ANTHROPIC_TOOL_SEARCH_BETA = 'advanced-tool-use-2025-11-20';

export interface AssembleToolRequestInput {
  readonly thread: string;
  readonly registry: ToolRegistry;
  readonly listOptions: { allowedTools?: ReadonlySet<string>; planMode?: 'normal' | 'plan' };
  readonly historyMessages: readonly { blocks?: readonly ContentBlock[] }[];
  readonly previouslyAnnounced: ReadonlySet<string>;
  readonly priorDiscovered: ReadonlySet<string>;
  readonly settings: ToolSearchSettings;
  readonly providerKind: ProviderKind;
  readonly modelId: string;
}

export interface AssembleToolRequestResult {
  readonly tools: readonly OpenAITool[];
  readonly providerHints: ProviderHints | undefined;
  readonly announcement: string | null;
  readonly nextPreviouslyAnnounced: ReadonlySet<string>;
  readonly nextDiscovered: ReadonlySet<string>;
  readonly enabled: boolean;
}

export function assembleToolRequest(input: AssembleToolRequestInput): AssembleToolRequestResult {
  const enabled = isToolSearchEnabled(input.settings);
  if (!enabled) {
    return {
      tools: input.registry.toOpenAITools(input.thread, input.listOptions),
      providerHints: undefined,
      announcement: null,
      nextPreviouslyAnnounced: input.previouslyAnnounced,
      nextDiscovered: input.priorDiscovered,
      enabled: false,
    };
  }

  const fromHistory = extractDiscoveredToolNamesFromHistory(input.historyMessages);
  const discovered = mergeDiscovered(input.priorDiscovered, fromHistory);

  const visibleSpecs = input.registry.listFor(
    input.thread,
    input.listOptions,
  ) as readonly ToolSpec[];
  const part = partitionTools(visibleSpecs, discovered, { toolSearchToolId: TOOL_SEARCH_TOOL_ID });

  const nativeDefer = isNativeDeferralSupported(input.modelId, input.providerKind, input.settings);

  const tools = input.registry.toOpenAITools(input.thread, {
    ...input.listOptions,
    deferralCtx: { deferLoading: part.deferLoading, nativeDefer },
  });

  const announcement = formatDeferredAnnouncement(part.deferLoading, input.previouslyAnnounced);

  const providerHints: ProviderHints | undefined = nativeDefer
    ? { betas: [ANTHROPIC_TOOL_SEARCH_BETA], nativeDeferral: true }
    : undefined;

  return {
    tools,
    providerHints,
    announcement,
    nextPreviouslyAnnounced: part.deferLoading,
    nextDiscovered: discovered,
    enabled: true,
  };
}
