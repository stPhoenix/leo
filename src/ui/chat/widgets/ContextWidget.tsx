import type { ContextData } from '@/agent/contextAnalyzer';
import { type CategoryId, type ContextCategory } from '@/ui/contextGrid';
import { AUTOCOMPACT_BUFFER_TOKENS } from '@/agent/compactConstants';
import { registerWidget, type WidgetComponentProps } from './registry';

export interface ContextWidgetPayload {
  readonly data: ContextData;
  readonly contextWindow: number;
}

const CATEGORY_LABELS: Readonly<Record<CategoryId, string>> = {
  system_prompt: 'system prompt',
  system_tools: 'built-in tools',
  mcp_tools: 'mcp tools',
  mcp_tools_deferred: 'mcp tools (deferred)',
  system_tools_deferred: 'built-in tools (deferred)',
  custom_agents: 'custom agents',
  memory_files: 'memory files',
  skills: 'skills',
  messages: 'messages',
  compact_buffer: 'compact buffer',
  free_space: 'free',
};

export function ContextWidget({ props }: WidgetComponentProps): JSX.Element {
  const payload = props as ContextWidgetPayload;
  return <ContextWidgetBody data={payload.data} contextWindow={payload.contextWindow} />;
}

interface BodyProps {
  readonly data: ContextData;
  readonly contextWindow: number;
}

function ContextWidgetBody({ data, contextWindow }: BodyProps): JSX.Element {
  const window = contextWindow > 0 ? contextWindow : 1;
  const used = sumUsed(data);
  const reserved = Math.min(AUTOCOMPACT_BUFFER_TOKENS, Math.max(0, window - used));
  const free = Math.max(0, window - used - reserved);
  const categories = buildCategories(data, reserved, free);
  const totalTokens = data.totalTokens > 0 ? data.totalTokens : used;
  const pct = Math.min(100, Math.round((totalTokens / window) * 100));
  const source = data.tokenTotalSource === 'api' ? 'measured' : 'estimated';
  const legend = categories.filter((c) => c.isFreeSpace !== true && c.tokens > 0);
  const arcs = buildArcs(categories, window);

  return (
    <section
      className="leo-context-widget"
      data-slot="context-widget"
      aria-label="Context usage breakdown"
    >
      <header className="leo-context-widget-head">
        <span className="leo-context-widget-title">Context</span>
        <span className="leo-context-widget-total" data-slot="widget-total">
          {fmt(totalTokens)} / {fmt(window)} ({pct}%)
        </span>
        <span className="leo-context-widget-meta" data-slot="widget-meta">
          {source} · {data.model} · {data.pipelineMessageCount} msgs
          {data.skillCountFailed ? ' · skills: count failed' : ''}
        </span>
      </header>
      <div className="leo-context-widget-chart" data-slot="widget-chart">
        <ContextDonut arcs={arcs} pct={pct} totalTokens={totalTokens} window={window} />
        <ul className="leo-context-widget-legend" data-slot="widget-legend">
          {legend.map((c) => (
            <li
              key={c.id}
              className={`leo-context-widget-legend-item leo-cat-${c.id}`}
              data-category={c.id}
            >
              <span className="leo-context-widget-legend-swatch" aria-hidden="true">
                ◉
              </span>
              <span className="leo-context-widget-legend-label">{c.label}</span>
              <span className="leo-context-widget-legend-value">{fmt(c.tokens)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

interface DonutArc {
  readonly id: CategoryId;
  readonly len: number;
  readonly offset: number;
}

const DONUT_RADIUS = 56;
const DONUT_STROKE = 18;
const DONUT_SIZE = 140;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function buildArcs(categories: readonly ContextCategory[], window: number): readonly DonutArc[] {
  const out: DonutArc[] = [];
  let cursor = 0;
  for (const c of categories) {
    if (c.isFreeSpace === true || c.tokens <= 0) continue;
    const len = (c.tokens / window) * DONUT_CIRCUMFERENCE;
    out.push({ id: c.id, len, offset: cursor });
    cursor += len;
  }
  return out;
}

interface DonutProps {
  readonly arcs: readonly DonutArc[];
  readonly pct: number;
  readonly totalTokens: number;
  readonly window: number;
}

function ContextDonut({ arcs, pct, totalTokens, window }: DonutProps): JSX.Element {
  const center = DONUT_SIZE / 2;
  return (
    <div className="leo-context-widget-donut" data-slot="widget-donut">
      <svg
        className="leo-context-widget-donut-svg"
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        role="img"
        aria-label={`Context usage: ${fmt(totalTokens)} of ${fmt(window)} tokens (${pct}%)`}
      >
        <circle
          className="leo-context-widget-donut-track"
          cx={center}
          cy={center}
          r={DONUT_RADIUS}
          fill="none"
          strokeWidth={DONUT_STROKE}
        />
        <g transform={`rotate(-90 ${center} ${center})`}>
          {arcs.map((arc) => (
            <circle
              key={arc.id}
              className={`leo-context-widget-donut-arc leo-cat-${arc.id}`}
              data-category={arc.id}
              cx={center}
              cy={center}
              r={DONUT_RADIUS}
              fill="none"
              strokeWidth={DONUT_STROKE}
              strokeDasharray={`${arc.len} ${DONUT_CIRCUMFERENCE - arc.len}`}
              strokeDashoffset={-arc.offset}
              stroke="currentColor"
            />
          ))}
        </g>
      </svg>
      <div className="leo-context-widget-donut-center" aria-hidden="true">
        <span className="leo-context-widget-donut-pct">{pct}%</span>
        <span className="leo-context-widget-donut-sub">used</span>
      </div>
    </div>
  );
}

function sumUsed(data: ContextData): number {
  return (
    data.systemTokens +
    data.memoryFileTokens +
    data.builtInToolTokens +
    data.mcpToolTokens +
    data.customAgentTokens +
    data.slashCommandTokens +
    data.messageTokens +
    data.skillTokens
  );
}

function buildCategories(data: ContextData, reserved: number, free: number): ContextCategory[] {
  return [
    { id: 'system_prompt', label: CATEGORY_LABELS.system_prompt, tokens: data.systemTokens },
    { id: 'system_tools', label: CATEGORY_LABELS.system_tools, tokens: data.builtInToolTokens },
    { id: 'mcp_tools', label: CATEGORY_LABELS.mcp_tools, tokens: data.mcpToolTokens },
    { id: 'custom_agents', label: CATEGORY_LABELS.custom_agents, tokens: data.customAgentTokens },
    { id: 'memory_files', label: CATEGORY_LABELS.memory_files, tokens: data.memoryFileTokens },
    { id: 'skills', label: CATEGORY_LABELS.skills, tokens: data.skillTokens },
    { id: 'messages', label: CATEGORY_LABELS.messages, tokens: data.messageTokens },
    {
      id: 'compact_buffer',
      label: CATEGORY_LABELS.compact_buffer,
      tokens: reserved,
      isReserved: true,
    },
    { id: 'free_space', label: CATEGORY_LABELS.free_space, tokens: free, isFreeSpace: true },
  ];
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

registerWidget('context', ContextWidget);
