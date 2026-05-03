import type { ProviderKind, ToolSearchSettings } from '@/settings/settingsStore';
import type { OpenAITool, ProviderHints } from '@/providers/types';
import type { ToolRegistry } from '@/tools/toolRegistry';
import type { ContentBlock } from '@/chat/types';
import type { ToolSpec } from '@/tools/types';
import type { SearchSnapshot } from '@/tools/toolSearch/types';
import { isDeferred } from '@/tools/toolSearch/deferralRules';
import { TOOL_SEARCH_TOOL_ID } from '@/tools/toolSearch/toolSearchTool';
import { assembleToolRequest } from './assembleToolRequest';
import { isNativeDeferralSupported, isToolSearchEnabled } from './modelGating';

interface PerThreadState {
  previouslyAnnounced: ReadonlySet<string>;
  discovered: ReadonlySet<string>;
}

export interface ToolSearchAssembleRequest {
  readonly thread: string;
  readonly registry: ToolRegistry;
  readonly listOptions: { allowedTools?: ReadonlySet<string>; planMode?: 'normal' | 'plan' };
  readonly historyMessages: readonly { blocks?: readonly ContentBlock[] }[];
  readonly modelId: string;
}

export interface ToolSearchAssembleResult {
  readonly tools: readonly OpenAITool[];
  readonly providerHints: ProviderHints | undefined;
  readonly announcement: string | null;
  readonly enabled: boolean;
}

export interface ToolSearchSessionDeps {
  readonly settings: () => ToolSearchSettings;
  readonly providerKind: () => ProviderKind;
  readonly modelId: () => string;
  readonly registry: () => ToolRegistry;
}

export class ToolSearchSession {
  private readonly states = new Map<string, PerThreadState>();

  constructor(private readonly deps: ToolSearchSessionDeps) {}

  assemble(input: ToolSearchAssembleRequest): ToolSearchAssembleResult {
    const prior = this.stateFor(input.thread);
    const result = assembleToolRequest({
      thread: input.thread,
      registry: input.registry,
      listOptions: input.listOptions,
      historyMessages: input.historyMessages,
      previouslyAnnounced: prior.previouslyAnnounced,
      priorDiscovered: prior.discovered,
      settings: this.deps.settings(),
      providerKind: this.deps.providerKind(),
      modelId: input.modelId,
    });
    if (result.enabled) {
      this.states.set(input.thread, {
        previouslyAnnounced: result.nextPreviouslyAnnounced,
        discovered: result.nextDiscovered,
      });
    }
    return {
      tools: result.tools,
      providerHints: result.providerHints,
      announcement: result.announcement,
      enabled: result.enabled,
    };
  }

  recordDiscovery(thread: string, names: readonly string[]): void {
    if (names.length === 0) return;
    const prior = this.stateFor(thread);
    const next = new Set(prior.discovered);
    let changed = false;
    for (const n of names) {
      if (!next.has(n)) {
        next.add(n);
        changed = true;
      }
    }
    if (!changed) return;
    this.states.set(thread, { ...prior, discovered: next });
  }

  reset(thread: string): void {
    this.states.delete(thread);
  }

  snapshotFor(thread: string): SearchSnapshot {
    const settings = this.deps.settings();
    const registry = this.deps.registry();
    const allSpecs = [...registry.listFor(thread, {})] as readonly ToolSpec[];
    const prior = this.stateFor(thread);
    const deferred: ToolSpec[] = [];
    const ctx = { toolSearchToolId: TOOL_SEARCH_TOOL_ID };
    const enabled = isToolSearchEnabled(settings);
    for (const spec of allSpecs) {
      if (!enabled) continue;
      if (!isDeferred(spec, ctx)) continue;
      if (prior.discovered.has(spec.id)) continue;
      deferred.push(spec);
    }
    const native = isNativeDeferralSupported(this.deps.modelId(), this.deps.providerKind(), settings);
    return { deferred, all: allSpecs, nativeDeferral: native };
  }

  private stateFor(thread: string): PerThreadState {
    let s = this.states.get(thread);
    if (s === undefined) {
      s = { previouslyAnnounced: new Set(), discovered: new Set() };
      this.states.set(thread, s);
    }
    return s;
  }
}
