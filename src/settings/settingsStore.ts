import type { Plugin } from 'obsidian';
import type { LogLevel } from '@/platform/logTypes';
import { isLogLevel } from '@/platform/logTypes';

export type SectionId =
  | 'provider'
  | 'indexing'
  | 'skills'
  | 'mcp'
  | 'plan'
  | 'externalAgents'
  | 'langfuse'
  | 'appearance'
  | 'advanced';

export type ProviderKind =
  | 'lmstudio'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'ollama-cloud'
  | 'custom';

export type RagMode = 'auto' | 'no-focus' | 'off';

export const RAG_MODES: readonly RagMode[] = ['auto', 'no-focus', 'off'];

export const DEFAULT_RAG_MODE: RagMode = 'no-focus';

export type AnthropicThinkingMode = 'off' | 'adaptive' | 'enabled';

export const ANTHROPIC_THINKING_MODES: readonly AnthropicThinkingMode[] = [
  'off',
  'adaptive',
  'enabled',
];

export const MIN_ANTHROPIC_THINKING_BUDGET = 1024;

export interface AnthropicThinkingSettings {
  mode: AnthropicThinkingMode;
  budgetTokens: number;
}

export interface ProviderSettings {
  kind: ProviderKind;
  endpoint: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  maxToolRoundTrips: number;
  disableParallelToolCalls: boolean;
  useExactTokenCountAnthropic: boolean;
  anthropicThinking: AnthropicThinkingSettings;
}

export interface EmbeddingProviderSettings {
  inheritFromChat: boolean;
  kind: ProviderKind;
  endpoint: string;
  model: string;
}

export interface UiSettings {
  firstRunComplete: boolean;
  firstChatViewOpened: boolean;
  expandedSections: Record<SectionId, boolean>;
}

export interface IndexingSettings {
  excludePatterns: string[];
}

export interface ProviderTimeoutSettings {
  firstEventMs: number;
  idleMs: number;
}

export interface LangfuseSettings {
  enabled: boolean;
  host: string;
}

export interface ExternalAgentInstanceSettings {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ExternalAgentsSettings {
  defaultAdapterId: string | null;
  adapters: Record<string, ExternalAgentInstanceSettings>;
}

export type ToolSearchMode = 'standard' | 'tst' | 'tst-auto';

export const TOOL_SEARCH_MODES: readonly ToolSearchMode[] = ['standard', 'tst', 'tst-auto'];

export interface ToolSearchSettings {
  mode: ToolSearchMode;
  killSwitch: boolean;
  unsupportedModelSubstrings: readonly string[];
}

export interface AttachmentsSettings {
  retentionDays: number;
}

export interface LeoSettings {
  schemaVersion: 1;
  logLevel: LogLevel;
  provider: ProviderSettings;
  embeddingProvider: EmbeddingProviderSettings;
  indexing: IndexingSettings;
  ui: UiSettings;
  providerTimeouts: ProviderTimeoutSettings;
  langfuse: LangfuseSettings;
  ragMode: RagMode;
  externalAgents: ExternalAgentsSettings;
  toolSearch: ToolSearchSettings;
  attachments: AttachmentsSettings;
  contextWindowOverride?: number;
}

export const DEFAULT_PROVIDER_TIMEOUTS: ProviderTimeoutSettings = {
  firstEventMs: 300_000,
  idleMs: 120_000,
};

export const DEFAULT_LANGFUSE: LangfuseSettings = {
  enabled: false,
  host: 'https://cloud.langfuse.com',
};

export const DEFAULT_INDEXING: IndexingSettings = {
  excludePatterns: [],
};

export const DEFAULT_EXTERNAL_AGENTS: ExternalAgentsSettings = {
  defaultAdapterId: null,
  adapters: {},
};

export const DEFAULT_TOOL_SEARCH: ToolSearchSettings = {
  mode: 'tst',
  killSwitch: false,
  unsupportedModelSubstrings: ['haiku'],
};

export const DEFAULT_ATTACHMENTS: AttachmentsSettings = {
  retentionDays: 7,
};

export const DEFAULT_ANTHROPIC_THINKING: AnthropicThinkingSettings = {
  mode: 'adaptive',
  budgetTokens: 4096,
};

export const DEFAULT_PROVIDER: ProviderSettings = {
  kind: 'lmstudio',
  endpoint: 'http://localhost:1234',
  chatModel: '',
  embeddingModel: '',
  temperature: 0.7,
  maxTokens: 2048,
  maxToolRoundTrips: 16,
  disableParallelToolCalls: false,
  useExactTokenCountAnthropic: false,
  anthropicThinking: { ...DEFAULT_ANTHROPIC_THINKING },
};

export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderSettings = {
  inheritFromChat: true,
  kind: 'lmstudio',
  endpoint: 'http://localhost:1234',
  model: '',
};

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'lmstudio',
  'openai',
  'anthropic',
  'google',
  'ollama',
  'ollama-cloud',
  'custom',
];

export const DEFAULT_EXPANDED: Record<SectionId, boolean> = {
  provider: true,
  indexing: false,
  skills: false,
  mcp: false,
  plan: false,
  externalAgents: false,
  langfuse: false,
  appearance: false,
  advanced: false,
};

export const DEFAULT_SETTINGS: LeoSettings = {
  schemaVersion: 1,
  logLevel: 'info',
  provider: DEFAULT_PROVIDER,
  embeddingProvider: DEFAULT_EMBEDDING_PROVIDER,
  indexing: DEFAULT_INDEXING,
  ui: {
    firstRunComplete: false,
    firstChatViewOpened: false,
    expandedSections: DEFAULT_EXPANDED,
  },
  providerTimeouts: { ...DEFAULT_PROVIDER_TIMEOUTS },
  langfuse: { ...DEFAULT_LANGFUSE },
  ragMode: DEFAULT_RAG_MODE,
  externalAgents: { ...DEFAULT_EXTERNAL_AGENTS, adapters: {} },
  toolSearch: {
    ...DEFAULT_TOOL_SEARCH,
    unsupportedModelSubstrings: [...DEFAULT_TOOL_SEARCH.unsupportedModelSubstrings],
  },
  attachments: { ...DEFAULT_ATTACHMENTS },
};

export function migrate(raw: unknown): LeoSettings {
  if (raw === null || typeof raw !== 'object') return cloneDefaults();
  const obj = raw as Record<string, unknown>;

  const logLevelRaw = obj.logLevel;
  const logLevel: LogLevel = isLogLevel(logLevelRaw) ? logLevelRaw : DEFAULT_SETTINGS.logLevel;

  const provider = mergeProvider(obj.provider);
  const embeddingProvider = mergeEmbeddingProvider(obj.embeddingProvider, provider);
  const indexing = mergeIndexing(obj.indexing);
  const ui = mergeUi(obj.ui, provider);
  const providerTimeouts = mergeProviderTimeouts(obj.providerTimeouts);
  const langfuse = mergeLangfuse(obj.langfuse);
  const ragMode = parseRagMode(obj.ragMode);
  const externalAgents = mergeExternalAgents(obj.externalAgents);
  const toolSearch = mergeToolSearch(obj.toolSearch);
  const attachments = mergeAttachments(obj.attachments);
  const contextWindowOverride = parseContextWindowOverride(obj.contextWindowOverride);

  return {
    schemaVersion: 1,
    logLevel,
    provider,
    embeddingProvider,
    indexing,
    ui,
    providerTimeouts,
    langfuse,
    ragMode,
    externalAgents,
    toolSearch,
    attachments,
    ...(contextWindowOverride !== undefined ? { contextWindowOverride } : {}),
  };
}

function mergeAttachments(raw: unknown): AttachmentsSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_ATTACHMENTS };
  const o = raw as Record<string, unknown>;
  return {
    retentionDays: clampInt(o.retentionDays, 0, 3650, DEFAULT_ATTACHMENTS.retentionDays),
  };
}

function mergeToolSearch(raw: unknown): ToolSearchSettings {
  if (raw === null || typeof raw !== 'object') {
    return {
      ...DEFAULT_TOOL_SEARCH,
      unsupportedModelSubstrings: [...DEFAULT_TOOL_SEARCH.unsupportedModelSubstrings],
    };
  }
  const o = raw as Record<string, unknown>;
  const mode: ToolSearchMode = (TOOL_SEARCH_MODES as readonly string[]).includes(
    o.mode as ToolSearchMode,
  )
    ? (o.mode as ToolSearchMode)
    : DEFAULT_TOOL_SEARCH.mode;
  const killSwitch =
    typeof o.killSwitch === 'boolean' ? o.killSwitch : DEFAULT_TOOL_SEARCH.killSwitch;
  const subs: string[] = [];
  if (Array.isArray(o.unsupportedModelSubstrings)) {
    for (const v of o.unsupportedModelSubstrings) {
      if (typeof v === 'string' && v.trim().length > 0) subs.push(v.trim().toLowerCase());
    }
  }
  return {
    mode,
    killSwitch,
    unsupportedModelSubstrings:
      subs.length > 0 ? subs : [...DEFAULT_TOOL_SEARCH.unsupportedModelSubstrings],
  };
}

function mergeExternalAgents(raw: unknown): ExternalAgentsSettings {
  if (raw === null || typeof raw !== 'object') {
    return { ...DEFAULT_EXTERNAL_AGENTS, adapters: {} };
  }
  const o = raw as Record<string, unknown>;
  const defaultId = typeof o.defaultAdapterId === 'string' ? o.defaultAdapterId : null;
  const adapters: Record<string, ExternalAgentInstanceSettings> = {};
  const adaptersRaw = o.adapters;
  if (adaptersRaw !== null && typeof adaptersRaw === 'object') {
    for (const [key, val] of Object.entries(adaptersRaw as Record<string, unknown>)) {
      if (val === null || typeof val !== 'object') continue;
      const v = val as Record<string, unknown>;
      adapters[key] = {
        enabled: typeof v.enabled === 'boolean' ? v.enabled : true,
        config:
          v.config !== null && typeof v.config === 'object'
            ? (v.config as Record<string, unknown>)
            : {},
      };
    }
  }
  return { defaultAdapterId: defaultId, adapters };
}

function parseRagMode(raw: unknown): RagMode {
  if (typeof raw === 'string' && (RAG_MODES as readonly string[]).includes(raw)) {
    return raw as RagMode;
  }
  return DEFAULT_RAG_MODE;
}

function mergeLangfuse(raw: unknown): LangfuseSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_LANGFUSE };
  const o = raw as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULT_LANGFUSE.enabled,
    host:
      typeof o.host === 'string' && o.host.trim().length > 0
        ? o.host.trim()
        : DEFAULT_LANGFUSE.host,
  };
}

function mergeProviderTimeouts(raw: unknown): ProviderTimeoutSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_PROVIDER_TIMEOUTS };
  const o = raw as Record<string, unknown>;
  return {
    firstEventMs: clampInt(
      o.firstEventMs,
      1_000,
      3_600_000,
      DEFAULT_PROVIDER_TIMEOUTS.firstEventMs,
    ),
    idleMs: clampInt(o.idleMs, 1_000, 3_600_000, DEFAULT_PROVIDER_TIMEOUTS.idleMs),
  };
}

function parseContextWindowOverride(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const i = Math.floor(v);
  if (i < 1) return undefined;
  return Math.min(i, 10_000_000);
}

function mergeIndexing(raw: unknown): IndexingSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_INDEXING };
  const o = raw as Record<string, unknown>;
  const patterns: string[] = [];
  if (Array.isArray(o.excludePatterns)) {
    for (const v of o.excludePatterns) {
      if (typeof v === 'string' && v.trim().length > 0) patterns.push(v.trim());
    }
  }
  return { excludePatterns: patterns };
}

function mergeEmbeddingProvider(raw: unknown, chat: ProviderSettings): EmbeddingProviderSettings {
  const inheritedDefaults: EmbeddingProviderSettings = {
    inheritFromChat: true,
    kind: chat.kind,
    endpoint: chat.endpoint,
    model: chat.embeddingModel,
  };
  if (raw === null || typeof raw !== 'object') return inheritedDefaults;
  const o = raw as Record<string, unknown>;
  const inherit =
    typeof o.inheritFromChat === 'boolean' ? o.inheritFromChat : inheritedDefaults.inheritFromChat;
  const kind: ProviderKind = PROVIDER_KINDS.includes(o.kind as ProviderKind)
    ? (o.kind as ProviderKind)
    : inheritedDefaults.kind;
  return {
    inheritFromChat: inherit,
    kind,
    endpoint: typeof o.endpoint === 'string' ? o.endpoint : inheritedDefaults.endpoint,
    model: typeof o.model === 'string' ? o.model : inheritedDefaults.model,
  };
}

function mergeProvider(raw: unknown): ProviderSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_PROVIDER };
  const o = raw as Record<string, unknown>;
  const kind: ProviderKind = PROVIDER_KINDS.includes(o.kind as ProviderKind)
    ? (o.kind as ProviderKind)
    : DEFAULT_PROVIDER.kind;
  return {
    kind,
    endpoint: typeof o.endpoint === 'string' ? o.endpoint : DEFAULT_PROVIDER.endpoint,
    chatModel: typeof o.chatModel === 'string' ? o.chatModel : DEFAULT_PROVIDER.chatModel,
    embeddingModel:
      typeof o.embeddingModel === 'string' ? o.embeddingModel : DEFAULT_PROVIDER.embeddingModel,
    temperature: clampNumber(o.temperature, 0, 2, DEFAULT_PROVIDER.temperature),
    maxTokens: clampInt(o.maxTokens, 1, 1_000_000, DEFAULT_PROVIDER.maxTokens),
    maxToolRoundTrips: clampInt(o.maxToolRoundTrips, 1, 256, DEFAULT_PROVIDER.maxToolRoundTrips),
    disableParallelToolCalls:
      typeof o.disableParallelToolCalls === 'boolean'
        ? o.disableParallelToolCalls
        : DEFAULT_PROVIDER.disableParallelToolCalls,
    useExactTokenCountAnthropic:
      typeof o.useExactTokenCountAnthropic === 'boolean'
        ? o.useExactTokenCountAnthropic
        : DEFAULT_PROVIDER.useExactTokenCountAnthropic,
    anthropicThinking: mergeAnthropicThinking(o.anthropicThinking),
  };
}

function mergeAnthropicThinking(raw: unknown): AnthropicThinkingSettings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_ANTHROPIC_THINKING };
  const o = raw as Record<string, unknown>;
  const mode: AnthropicThinkingMode = (ANTHROPIC_THINKING_MODES as readonly string[]).includes(
    o.mode as AnthropicThinkingMode,
  )
    ? (o.mode as AnthropicThinkingMode)
    : DEFAULT_ANTHROPIC_THINKING.mode;
  const budgetTokens = clampInt(
    o.budgetTokens,
    MIN_ANTHROPIC_THINKING_BUDGET,
    1_000_000,
    DEFAULT_ANTHROPIC_THINKING.budgetTokens,
  );
  return { mode, budgetTokens };
}

function mergeUi(raw: unknown, provider: ProviderSettings): UiSettings {
  const inferredFirstRun = provider.chatModel.length > 0 || provider.embeddingModel.length > 0;
  if (raw === null || typeof raw !== 'object') {
    return {
      firstRunComplete: inferredFirstRun,
      firstChatViewOpened: inferredFirstRun,
      expandedSections: { ...DEFAULT_EXPANDED },
    };
  }
  const o = raw as Record<string, unknown>;
  const firstRunComplete =
    typeof o.firstRunComplete === 'boolean' ? o.firstRunComplete : inferredFirstRun;
  const firstChatViewOpened =
    typeof o.firstChatViewOpened === 'boolean' ? o.firstChatViewOpened : inferredFirstRun;
  const expandedSections: Record<SectionId, boolean> = { ...DEFAULT_EXPANDED };
  const rawExpanded = o.expandedSections;
  if (rawExpanded !== null && typeof rawExpanded === 'object') {
    for (const id of Object.keys(DEFAULT_EXPANDED) as SectionId[]) {
      const v = (rawExpanded as Record<string, unknown>)[id];
      if (typeof v === 'boolean') expandedSections[id] = v;
    }
  }
  return { firstRunComplete, firstChatViewOpened, expandedSections };
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.min(Math.max(v, min), max);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const i = Math.floor(v);
  return Math.min(Math.max(i, min), max);
}

function cloneDefaults(): LeoSettings {
  return {
    schemaVersion: 1,
    logLevel: DEFAULT_SETTINGS.logLevel,
    provider: { ...DEFAULT_PROVIDER, anthropicThinking: { ...DEFAULT_ANTHROPIC_THINKING } },
    embeddingProvider: { ...DEFAULT_EMBEDDING_PROVIDER },
    indexing: { excludePatterns: [...DEFAULT_INDEXING.excludePatterns] },
    ui: {
      firstRunComplete: DEFAULT_SETTINGS.ui.firstRunComplete,
      firstChatViewOpened: DEFAULT_SETTINGS.ui.firstChatViewOpened,
      expandedSections: { ...DEFAULT_EXPANDED },
    },
    providerTimeouts: { ...DEFAULT_PROVIDER_TIMEOUTS },
    langfuse: { ...DEFAULT_LANGFUSE },
    ragMode: DEFAULT_RAG_MODE,
    externalAgents: { ...DEFAULT_EXTERNAL_AGENTS, adapters: {} },
    toolSearch: {
      ...DEFAULT_TOOL_SEARCH,
      unsupportedModelSubstrings: [...DEFAULT_TOOL_SEARCH.unsupportedModelSubstrings],
    },
    attachments: { ...DEFAULT_ATTACHMENTS },
  };
}

export type SettingsListener = (next: LeoSettings) => void;

export class SettingsStore {
  private current: LeoSettings = cloneDefaults();
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly plugin: Pick<Plugin, 'loadData' | 'saveData'>) {}

  async load(): Promise<LeoSettings> {
    const raw = await this.plugin.loadData();
    this.current = migrate(raw);
    return this.current;
  }

  get(): LeoSettings {
    return this.current;
  }

  async update(patch: (prev: LeoSettings) => LeoSettings): Promise<LeoSettings> {
    this.current = patch(this.current);
    await this.plugin.saveData(this.current);
    for (const l of this.listeners) l(this.current);
    return this.current;
  }

  on(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const SECTION_ORDER: readonly SectionId[] = [
  'provider',
  'indexing',
  'skills',
  'mcp',
  'plan',
  'externalAgents',
  'langfuse',
  'appearance',
  'advanced',
] as const;

export const SECTION_LABELS: Record<SectionId, string> = {
  provider: 'Provider',
  indexing: 'Indexing',
  skills: 'Skills',
  mcp: 'MCP Servers',
  plan: 'Plan / Todos',
  externalAgents: 'External Agents',
  langfuse: 'Tracing (Langfuse)',
  appearance: 'Appearance',
  advanced: 'Advanced',
};

export const SECTION_PLACEHOLDERS: Partial<Record<SectionId, string>> = {
  plan: 'Plan-mode allowlist and stale-todo threshold are fixed defaults in this build — no per-user knobs yet.',
  appearance:
    'Leo uses your active Obsidian theme by default. Theme overrides are not yet configurable.',
};
