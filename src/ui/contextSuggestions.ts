export const CONTEXT_SUGGESTION_THRESHOLDS = Object.freeze({
  NEAR_CAPACITY_PERCENT: 80,
  LARGE_TOOL_RESULT_PERCENT: 15,
  LARGE_TOOL_RESULT_TOKENS: 10_000,
  READ_BLOAT_PERCENT: 5,
  READ_BLOAT_TOKENS: 10_000,
  MEMORY_HIGH_PERCENT: 5,
  MEMORY_HIGH_TOKENS: 5_000,
  AUTOCOMPACT_DISABLED_LOWER_PERCENT: 50,
});

export interface ContextSuggestion {
  readonly id: string;
  readonly severity: 'info' | 'warning';
  readonly title: string;
  readonly detail: string;
  readonly savingsTokens?: number;
}

export interface MemoryFile {
  readonly path: string;
  readonly tokens: number;
}

export interface ToolBreakdown {
  readonly name: string;
  readonly tokens: number;
}

export interface ContextSuggestionInputs {
  readonly percentage: number;
  readonly isAutoCompactEnabled: boolean;
  readonly totalTokens: number;
  readonly autoCompactThreshold?: number;
  readonly toolResultsByType?: readonly ToolBreakdown[];
  readonly readTokens?: number;
  readonly memoryTokens?: number;
  readonly memoryFiles?: readonly MemoryFile[];
  readonly contextWindow: number;
}

const PER_TOOL_RULES: Record<string, { severity: 'info' | 'warning'; multiplier: number }> = {
  Bash: { severity: 'warning', multiplier: 0.5 },
  Read: { severity: 'info', multiplier: 0.3 },
  Grep: { severity: 'info', multiplier: 0.3 },
  WebFetch: { severity: 'info', multiplier: 0.4 },
};

const GENERIC_TOOL_RULE = { severity: 'info' as const, multiplier: 0.2 };

function checkNearCapacity(data: ContextSuggestionInputs): ContextSuggestion | null {
  const t = CONTEXT_SUGGESTION_THRESHOLDS;
  if (data.percentage < t.NEAR_CAPACITY_PERCENT) return null;
  const detail = data.isAutoCompactEnabled
    ? 'Use /compact now to control what gets kept'
    : 'Use /compact or enable autocompact';
  const savings =
    data.autoCompactThreshold !== undefined
      ? Math.max(0, data.totalTokens - data.autoCompactThreshold)
      : undefined;
  return {
    id: 'near_capacity',
    severity: 'warning',
    title: `Context near capacity (${Math.round(data.percentage)}%)`,
    detail,
    ...(savings !== undefined ? { savingsTokens: savings } : {}),
  };
}

function checkToolBloat(
  data: ContextSuggestionInputs,
  toolsFlagged: Set<string>,
): ContextSuggestion[] {
  const t = CONTEXT_SUGGESTION_THRESHOLDS;
  const out: ContextSuggestion[] = [];
  for (const tool of data.toolResultsByType ?? []) {
    const toolPercent = (tool.tokens / data.contextWindow) * 100;
    const isLarge =
      tool.tokens > t.LARGE_TOOL_RESULT_TOKENS && toolPercent > t.LARGE_TOOL_RESULT_PERCENT;
    if (!isLarge) continue;
    const rule = PER_TOOL_RULES[tool.name] ?? (toolPercent >= 20 ? GENERIC_TOOL_RULE : null);
    if (rule === null) continue;
    out.push({
      id: `large_tool_result:${tool.name}`,
      severity: rule.severity,
      title: `${tool.name} results using ${Math.round(toolPercent)}% of context`,
      detail: `Consider consolidating ${tool.name} calls or narrowing scope.`,
      savingsTokens: Math.round(tool.tokens * rule.multiplier),
    });
    toolsFlagged.add(tool.name);
  }
  return out;
}

function checkReadBloat(
  data: ContextSuggestionInputs,
  toolsFlagged: ReadonlySet<string>,
): ContextSuggestion | null {
  const t = CONTEXT_SUGGESTION_THRESHOLDS;
  const readTokens = data.readTokens ?? 0;
  if (toolsFlagged.has('Read') || readTokens < t.READ_BLOAT_TOKENS) return null;
  const pct = (readTokens / data.contextWindow) * 100;
  if (pct < t.READ_BLOAT_PERCENT) return null;
  return {
    id: 'read_bloat',
    severity: 'info',
    title: 'Earlier file reads are heavy in context',
    detail: 'Re-read with smaller offset/limit or drop stale Read calls.',
    savingsTokens: Math.round(readTokens * 0.3),
  };
}

function checkMemoryBloat(data: ContextSuggestionInputs): ContextSuggestion | null {
  const t = CONTEXT_SUGGESTION_THRESHOLDS;
  const memoryTokens = data.memoryTokens ?? 0;
  if (memoryTokens < t.MEMORY_HIGH_TOKENS) return null;
  const pct = (memoryTokens / data.contextWindow) * 100;
  if (pct < t.MEMORY_HIGH_PERCENT) return null;
  const files = [...(data.memoryFiles ?? [])].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
  const names = files.map((f) => f.path).join(', ');
  const topTokens = files.reduce((s, f) => s + f.tokens, 0);
  return {
    id: 'memory_bloat',
    severity: 'info',
    title: 'Memory files using significant context',
    detail: `Largest: ${names}. Trim via /memory.`,
    savingsTokens: topTokens,
  };
}

function checkAutocompactDisabled(data: ContextSuggestionInputs): ContextSuggestion | null {
  const t = CONTEXT_SUGGESTION_THRESHOLDS;
  if (data.isAutoCompactEnabled) return null;
  if (data.percentage < t.AUTOCOMPACT_DISABLED_LOWER_PERCENT) return null;
  if (data.percentage >= t.NEAR_CAPACITY_PERCENT) return null;
  return {
    id: 'autocompact_disabled',
    severity: 'info',
    title: 'Autocompact is disabled',
    detail: 'Enable autocompact in settings to automatically manage context.',
  };
}

export function generateContextSuggestions(data: ContextSuggestionInputs): ContextSuggestion[] {
  const out: ContextSuggestion[] = [];
  const nearCapacity = checkNearCapacity(data);
  if (nearCapacity !== null) out.push(nearCapacity);
  const toolsFlagged = new Set<string>();
  out.push(...checkToolBloat(data, toolsFlagged));
  const readBloat = checkReadBloat(data, toolsFlagged);
  if (readBloat !== null) out.push(readBloat);
  const memoryBloat = checkMemoryBloat(data);
  if (memoryBloat !== null) out.push(memoryBloat);
  const autoCompactDisabled = checkAutocompactDisabled(data);
  if (autoCompactDisabled !== null) out.push(autoCompactDisabled);
  return sortSuggestions(out);
}

export function sortSuggestions(suggestions: readonly ContextSuggestion[]): ContextSuggestion[] {
  const indexed = suggestions.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => {
    const sevA = a.s.severity === 'warning' ? 0 : 1;
    const sevB = b.s.severity === 'warning' ? 0 : 1;
    if (sevA !== sevB) return sevA - sevB;
    const savA = a.s.savingsTokens ?? 0;
    const savB = b.s.savingsTokens ?? 0;
    if (savA !== savB) return savB - savA;
    return a.i - b.i;
  });
  return indexed.map((x) => x.s);
}

export interface ApiUsageLike {
  readonly input_tokens: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export interface StatusLineContext {
  readonly total_input_tokens: number;
  readonly total_output_tokens: number;
  readonly context_window_size: number;
  readonly current_usage: number;
  readonly used_percentage: number;
  readonly remaining_percentage: number;
}

export function buildStatusLineContext(
  apiUsage: ApiUsageLike | null | undefined,
  contextWindowSize: number,
): StatusLineContext | null {
  if (apiUsage === null || apiUsage === undefined) return null;
  const input = apiUsage.input_tokens;
  const output = apiUsage.output_tokens ?? 0;
  const cacheCreate = apiUsage.cache_creation_input_tokens ?? 0;
  const cacheRead = apiUsage.cache_read_input_tokens ?? 0;
  const totalInput = input + cacheCreate + cacheRead;
  const usedPct =
    contextWindowSize > 0 ? clamp(Math.round((totalInput / contextWindowSize) * 100), 0, 100) : 0;
  return {
    total_input_tokens: totalInput,
    total_output_tokens: output,
    context_window_size: contextWindowSize,
    current_usage: totalInput,
    used_percentage: usedPct,
    remaining_percentage: 100 - usedPct,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface StatusLineUpdateDeps {
  readonly build: () => StatusLineContext | null;
  readonly write: (ctx: StatusLineContext | null) => void;
  readonly debounceMs?: number;
  readonly setTimeoutFn?: typeof setTimeout;
  readonly clearTimeoutFn?: typeof clearTimeout;
  readonly onError?: (err: Error) => void;
}

export interface StatusLineUpdater {
  readonly trigger: () => void;
  readonly dispose: () => void;
}

export function createDebouncedStatusLineUpdater(deps: StatusLineUpdateDeps): StatusLineUpdater {
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const debounceMs = deps.debounceMs ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = (): void => {
    timer = null;
    if (disposed) return;
    try {
      deps.write(deps.build());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      deps.onError?.(error);
    }
  };

  const trigger = (): void => {
    if (disposed) return;
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(flush, debounceMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  };

  return { trigger, dispose };
}
