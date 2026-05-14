// Doc §9 substitutions. Leo-specific deviations:
//   - step 5 (inline shell) is not implemented; Leo runs in Electron renderer
//     without a shell surface. Bodies that use !`cmd` are left as-is.

import type { InvocationContext } from './types';

export interface SubstitutionInput {
  readonly body: string;
  readonly args: string;
  readonly argNames?: readonly string[];
  readonly baseDir?: string;
  readonly ctx: InvocationContext;
}

export function applySubstitutions(input: SubstitutionInput): string {
  let out = input.body;
  const positional = splitArgs(input.args);
  const named = resolveNamed(positional, input.argNames);

  if (input.baseDir !== undefined && input.baseDir.length > 0) {
    out = `Base directory for this skill: ${input.baseDir}\n\n${out}`;
  }

  out = substituteArgs(out, positional, named, input.args);
  if (input.baseDir !== undefined) {
    const normalized = input.baseDir.replace(/\\/g, '/');
    out = out.replace(/\$\{CLAUDE_SKILL_DIR\}/g, normalized);
  }
  if (input.ctx.sessionId !== undefined) {
    out = out.replace(/\$\{CLAUDE_SESSION_ID\}/g, input.ctx.sessionId);
  }
  return out;
}

interface SplitState {
  buf: string;
  quote: '"' | "'" | null;
}

function stepQuotedChar(state: SplitState, c: string): void {
  if (c === state.quote) state.quote = null;
  else state.buf += c;
}

function stepUnquotedChar(state: SplitState, c: string, out: string[]): void {
  if (c === '"' || c === "'") {
    state.quote = c;
    return;
  }
  if (c === ' ' || c === '\t') {
    if (state.buf.length > 0) {
      out.push(state.buf);
      state.buf = '';
    }
    return;
  }
  state.buf += c;
}

function splitArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  const out: string[] = [];
  const state: SplitState = { buf: '', quote: null };
  for (let i = 0; i < trimmed.length; i += 1) {
    const c = trimmed[i]!;
    if (state.quote !== null) stepQuotedChar(state, c);
    else stepUnquotedChar(state, c, out);
  }
  if (state.buf.length > 0) out.push(state.buf);
  return out;
}

function resolveNamed(
  positional: readonly string[],
  argNames: readonly string[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (argNames === undefined) return out;
  for (let i = 0; i < argNames.length; i += 1) {
    const name = argNames[i];
    if (name === undefined || name.length === 0) continue;
    out[name] = positional[i] ?? '';
  }
  return out;
}

function substituteArgs(
  body: string,
  positional: readonly string[],
  named: Record<string, string>,
  raw: string,
): string {
  let out = body;
  out = out.replace(/\$ARGUMENTS\b/g, raw);
  out = out.replace(/\$(\d+)/g, (_match, digits: string) => {
    const index = Number.parseInt(digits, 10) - 1;
    return positional[index] ?? '';
  });
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(named, name)) {
      return named[name] ?? '';
    }
    return match;
  });
  return out;
}
