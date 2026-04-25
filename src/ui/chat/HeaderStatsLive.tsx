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

export interface IndexProgressSnapshot {
  readonly indexed: number;
  readonly total: number;
  readonly busy: boolean;
}

export interface IndexProgressSource {
  readonly getSnapshot: () => IndexProgressSnapshot;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface HeaderStatsLiveProps {
  readonly context: ContextUsageSource;
  readonly index: IndexProgressSource;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function HeaderStatsLive(props: HeaderStatsLiveProps): JSX.Element {
  const ctx = useSyncExternalStore<ContextUsageSnapshot>(
    props.context.subscribe,
    props.context.getSnapshot,
    props.context.getSnapshot,
  );
  const idx = useSyncExternalStore<IndexProgressSnapshot>(
    props.index.subscribe,
    props.index.getSnapshot,
    props.index.getSnapshot,
  );

  const ctxPct = ctx.window > 0 ? (ctx.tokens / ctx.window) * 100 : 0;
  const ctxDetail = `${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.window)} tokens`;

  const idxKnown = idx.total > 0;
  const idxPct = idxKnown ? (idx.indexed / idx.total) * 100 : 100;
  const idxDetail = idx.busy
    ? `indexing ${fmtCount(idx.indexed)} / ${fmtCount(idx.total)} files`
    : idxKnown
      ? `${fmtCount(idx.total)} files indexed`
      : 'index idle';

  return (
    <>
      <HeaderStat variant="context" label="ctx" pct={ctxPct} detail={ctxDetail} />
      <HeaderStat variant="index" label="idx" pct={idxPct} detail={idxDetail} busy={idx.busy} />
    </>
  );
}
