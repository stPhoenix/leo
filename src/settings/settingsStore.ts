import type { Plugin } from 'obsidian';
import type { LogLevel } from '@/platform/logTypes';
import { isLogLevel } from '@/platform/logTypes';

export type SectionId =
  | 'provider'
  | 'indexing'
  | 'skills'
  | 'mcp'
  | 'plan'
  | 'langfuse'
  | 'appearance'
  | 'advanced';

export type ProviderKind = 'lmstudio' | 'openai' | 'anthropic' | 'ollama' | 'custom';

export interface ProviderSettings {
  kind: ProviderKind;
  endpoint: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
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

export interface LeoSettings {
  schemaVersion: 1;
  logLevel: LogLevel;
  provider: ProviderSettings;
  indexing: IndexingSettings;
  ui: UiSettings;
  providerTimeouts: ProviderTimeoutSettings;
  langfuse: LangfuseSettings;
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

export const DEFAULT_PROVIDER: ProviderSettings = {
  kind: 'lmstudio',
  endpoint: 'http://localhost:1234',
  chatModel: '',
  embeddingModel: '',
  temperature: 0.7,
  maxTokens: 2048,
};

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'lmstudio',
  'openai',
  'anthropic',
  'ollama',
  'custom',
];

export const DEFAULT_EXPANDED: Record<SectionId, boolean> = {
  provider: true,
  indexing: false,
  skills: false,
  mcp: false,
  plan: false,
  langfuse: false,
  appearance: false,
  advanced: false,
};

export const DEFAULT_SETTINGS: LeoSettings = {
  schemaVersion: 1,
  logLevel: 'info',
  provider: DEFAULT_PROVIDER,
  indexing: DEFAULT_INDEXING,
  ui: {
    firstRunComplete: false,
    firstChatViewOpened: false,
    expandedSections: DEFAULT_EXPANDED,
  },
  providerTimeouts: { ...DEFAULT_PROVIDER_TIMEOUTS },
  langfuse: { ...DEFAULT_LANGFUSE },
};

export function migrate(raw: unknown): LeoSettings {
  if (raw === null || typeof raw !== 'object') return cloneDefaults();
  const obj = raw as Record<string, unknown>;

  const logLevelRaw = obj.logLevel;
  const logLevel: LogLevel = isLogLevel(logLevelRaw) ? logLevelRaw : DEFAULT_SETTINGS.logLevel;

  const provider = mergeProvider(obj.provider);
  const indexing = mergeIndexing(obj.indexing);
  const ui = mergeUi(obj.ui, provider);
  const providerTimeouts = mergeProviderTimeouts(obj.providerTimeouts);
  const langfuse = mergeLangfuse(obj.langfuse);
  const contextWindowOverride = parseContextWindowOverride(obj.contextWindowOverride);

  return {
    schemaVersion: 1,
    logLevel,
    provider,
    indexing,
    ui,
    providerTimeouts,
    langfuse,
    ...(contextWindowOverride !== undefined ? { contextWindowOverride } : {}),
  };
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
  };
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
    provider: { ...DEFAULT_PROVIDER },
    indexing: { excludePatterns: [...DEFAULT_INDEXING.excludePatterns] },
    ui: {
      firstRunComplete: DEFAULT_SETTINGS.ui.firstRunComplete,
      firstChatViewOpened: DEFAULT_SETTINGS.ui.firstChatViewOpened,
      expandedSections: { ...DEFAULT_EXPANDED },
    },
    providerTimeouts: { ...DEFAULT_PROVIDER_TIMEOUTS },
    langfuse: { ...DEFAULT_LANGFUSE },
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
  langfuse: 'Tracing (Langfuse)',
  appearance: 'Appearance',
  advanced: 'Advanced',
};

export const SECTION_PLACEHOLDERS: Partial<Record<SectionId, string>> = {
  plan: 'Plan-mode allowlist and stale-todo threshold are fixed defaults in this build — no per-user knobs yet.',
  appearance:
    'Leo uses your active Obsidian theme by default. Theme overrides are not yet configurable.',
};
