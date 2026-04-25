import { useSyncExternalStore } from 'react';
import { HeaderStat } from './HeaderStat';

export interface ContextUsageSnapshot {
  readonly tokens: number;
  readonly window: number;
}

export interface ContextUsageSource {
  readonly getSnapshot: () => ContextUsageSnapshot;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface HeaderStatsLiveProps {
  readonly context: ContextUsageSource;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function HeaderStatsLive(props: HeaderStatsLiveProps): JSX.Element {
  const ctx = useSyncExternalStore<ContextUsageSnapshot>(
    props.context.subscribe,
    props.context.getSnapshot,
    props.context.getSnapshot,
  );

  const ctxPct = ctx.window > 0 ? (ctx.tokens / ctx.window) * 100 : 0;
  const ctxDetail = `${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.window)} tokens`;

  return <HeaderStat variant="context" label="ctx" pct={ctxPct} detail={ctxDetail} />;
}
