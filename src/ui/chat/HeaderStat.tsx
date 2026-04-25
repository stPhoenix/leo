export type HeaderStatVariant = 'context' | 'index';

export interface HeaderStatProps {
  readonly variant: HeaderStatVariant;
  readonly label: string;
  readonly pct: number;
  readonly detail: string;
  readonly busy?: boolean;
}

function clampPct(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function levelForContext(pct: number): 'ok' | 'warn' | 'high' | 'critical' {
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'high';
  if (pct >= 50) return 'warn';
  return 'ok';
}

function levelForIndex(pct: number, busy: boolean): 'ok' | 'warn' | 'high' | 'critical' {
  if (busy) return 'warn';
  if (pct >= 99) return 'ok';
  if (pct >= 50) return 'high';
  return 'critical';
}

function levelFor(variant: HeaderStatVariant, pct: number, busy: boolean): string {
  return variant === 'index' ? levelForIndex(pct, busy) : levelForContext(pct);
}

export function HeaderStat(props: HeaderStatProps): JSX.Element {
  const pct = clampPct(props.pct);
  const busy = props.busy === true;
  const level = levelFor(props.variant, pct, busy);
  const className = [
    'leo-header-stat',
    `leo-header-stat-${props.variant}`,
    `is-level-${level}`,
    busy ? 'is-busy' : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  return (
    <span
      className={className}
      data-slot={`header-stat-${props.variant}`}
      title={`${props.label}: ${props.detail}`}
      role="img"
      aria-label={`${props.label} ${pct}% — ${props.detail}`}
    >
      <span className="leo-header-stat-label" aria-hidden="true">
        {props.label}
      </span>
      <span className="leo-header-stat-bar" aria-hidden="true">
        <span className="leo-header-stat-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="leo-header-stat-value" aria-hidden="true">
        {Math.round(pct)}%
      </span>
    </span>
  );
}
