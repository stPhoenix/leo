import { useEffect, useState } from 'react';

const DEFAULT_VARS: readonly string[] = [
  '--background-primary',
  '--background-secondary',
  '--background-modifier-border',
  '--background-modifier-hover',
  '--text-normal',
  '--text-muted',
  '--text-faint',
  '--text-on-accent',
  '--text-error',
  '--text-accent',
  '--interactive-accent',
  '--interactive-accent-hover',
  '--font-text',
  '--font-interface',
  '--font-monospace',
  '--radius-s',
  '--radius-m',
  '--color-green',
  '--color-yellow',
  '--color-orange',
  '--color-red',
];

export interface UseObsidianThemeVarsOptions {
  readonly vars?: readonly string[];
  readonly subscribeThemeChange?: (cb: () => void) => () => void;
  readonly readVar?: (name: string) => string;
}

export interface ObsidianThemeSnapshot {
  readonly css: string;
  readonly map: Readonly<Record<string, string>>;
}

function defaultReadVar(name: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function snapshot(vars: readonly string[], read: (name: string) => string): ObsidianThemeSnapshot {
  const map: Record<string, string> = {};
  const decls: string[] = [];
  for (const name of vars) {
    const value = read(name);
    if (value.length === 0) continue;
    map[name] = value;
    decls.push(`${name}: ${value};`);
  }
  return {
    css: `:root{${decls.join(' ')}}`,
    map,
  };
}

export function useObsidianThemeVars(
  opts: UseObsidianThemeVarsOptions = {},
): ObsidianThemeSnapshot {
  const vars = opts.vars ?? DEFAULT_VARS;
  const read = opts.readVar ?? defaultReadVar;
  const [snap, setSnap] = useState<ObsidianThemeSnapshot>(() => snapshot(vars, read));

  useEffect(() => {
    if (opts.subscribeThemeChange === undefined) return;
    const unsubscribe = opts.subscribeThemeChange(() => {
      setSnap(snapshot(vars, read));
    });
    return unsubscribe;
  }, [opts.subscribeThemeChange, vars, read]);

  return snap;
}
