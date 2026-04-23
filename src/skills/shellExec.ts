// Doc §9 step 5, Leo variant. Instead of a POSIX shell we evaluate inline
// expressions as sandboxed JavaScript, using the same `new Function` pattern
// already shipped in `src/tools/user/userToolsLoader.ts`. Bodies authored for
// Claude Code's `!`git status`` syntax will NOT port literally — Leo treats
// the backtick body as a JS expression, and the fenced `!` block as an async
// function body. The returned value is coerced to a string and spliced into
// the prompt.
//
// Skills loaded from MCP are never expanded here (remote/untrusted).

import type { ShellSpec } from './types';

export interface ShellExecContext {
  readonly skillDir?: string;
  readonly sessionId?: string;
  readonly threadId?: string;
  readonly args: string;
}

export interface EvaluateOptions {
  readonly body: string;
  readonly ctx: ShellExecContext;
  readonly spec?: ShellSpec;
  readonly extraGlobals?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 2_000;

const INLINE_RE = /!`([^`\n]+?)`/g;
const FENCED_RE = /```!\r?\n([\s\S]*?)\r?\n```/g;

export async function evaluateShellInBody(opts: EvaluateOptions): Promise<string> {
  if (!containsShellExpression(opts.body)) return opts.body;
  const timeoutMs = opts.spec?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fencedReplaced = await replaceAsync(opts.body, FENCED_RE, (match) => {
    const inner = match.replace(/^```!\r?\n/, '').replace(/\r?\n```$/, '');
    return runSnippet({
      source: inner,
      wrapAsFunction: true,
      opts,
      timeoutMs,
    });
  });
  const inlineReplaced = await replaceAsync(fencedReplaced, INLINE_RE, (match) => {
    const inner = match.replace(/^!`/, '').replace(/`$/, '');
    return runSnippet({
      source: inner,
      wrapAsFunction: false,
      opts,
      timeoutMs,
    });
  });
  return inlineReplaced;
}

export function containsShellExpression(body: string): boolean {
  INLINE_RE.lastIndex = 0;
  FENCED_RE.lastIndex = 0;
  return INLINE_RE.test(body) || FENCED_RE.test(body);
}

async function replaceAsync(
  source: string,
  pattern: RegExp,
  replacer: (match: string) => Promise<string>,
): Promise<string> {
  const matches: Array<{ start: number; end: number; promise: Promise<string> }> = [];
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    matches.push({ start, end, promise: replacer(m[0]) });
    if (!pattern.global) break;
  }
  if (matches.length === 0) return source;
  const resolved = await Promise.all(matches.map((x) => x.promise));
  let out = '';
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    out += source.slice(cursor, match.start);
    out += resolved[i];
    cursor = match.end;
  }
  out += source.slice(cursor);
  return out;
}

async function runSnippet(args: {
  readonly source: string;
  readonly wrapAsFunction: boolean;
  readonly opts: EvaluateOptions;
  readonly timeoutMs: number;
}): Promise<string> {
  const { source, wrapAsFunction, opts, timeoutMs } = args;
  const sandboxCtx = buildSandbox(opts);
  const body = wrapAsFunction ? source : `return (${source});`;
  const factory = new Function(
    'ctx',
    `"use strict"; return (async function __leoSkillShell(ctx) { ${body} })(ctx);`,
  ) as (ctx: Record<string, unknown>) => Promise<unknown>;
  try {
    const result = await withTimeout(factory(sandboxCtx), timeoutMs, opts.signal);
    if (result === undefined || result === null) return '';
    return typeof result === 'string' ? result : String(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[skill shell error: ${message}]`;
  }
}

function buildSandbox(opts: EvaluateOptions): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    args: opts.ctx.args,
    skillDir: opts.ctx.skillDir ?? null,
    sessionId: opts.ctx.sessionId ?? null,
    threadId: opts.ctx.threadId ?? null,
    signal: opts.signal ?? null,
  };
  if (opts.extraGlobals !== undefined) {
    for (const [k, v] of Object.entries(opts.extraGlobals)) ctx[k] = v;
  }
  return ctx;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (timeoutMs <= 0 && signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`shell timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
