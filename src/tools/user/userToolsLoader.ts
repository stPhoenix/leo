import { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { JsonSchema, ToolCtx, ToolResult, ToolSpec } from '../types';
import { isSafeVaultPath } from '../builtin/readNote';

// User tools author their own JsonSchema via JSON; schema is a permissive
// pass-through so ToolSpec's zod contract is satisfied without forcing users
// to hand-write zod. Validation happens downstream by the tool impl.
const permissiveUserSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

export const USER_TOOLS_DIR = '.leo/tools';

export type VaultOpKind = 'read' | 'create' | 'append';

export interface VaultOpDeclaration {
  readonly kind: 'vault-op';
  readonly op: VaultOpKind;
  readonly pathArg: string;
  readonly contentArg?: string;
}

export interface JsDeclaration {
  readonly kind: 'js';
  readonly source: string;
}

export interface UserToolDeclaration {
  readonly id: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly requiresConfirmation?: boolean;
  readonly impl: VaultOpDeclaration | JsDeclaration;
}

export interface UserToolsLoaderOptions {
  readonly vault: VaultAdapter;
  readonly registry: ToolRegistryLike;
  readonly logger?: Logger;
  readonly notice?: { notify(message: string): void };
  readonly jsContext?: Record<string, unknown>;
  readonly dir?: string;
}

export interface ToolRegistryLike {
  register(spec: ToolSpec<unknown, unknown>): void;
  lookup(id: string): ToolSpec<unknown, unknown> | undefined;
}

interface CompiledJsImpl {
  readonly fn: (ctx: Record<string, unknown>, args: unknown) => Promise<unknown>;
}

export async function loadUserTools(opts: UserToolsLoaderOptions): Promise<number> {
  const dir = opts.dir ?? USER_TOOLS_DIR;
  try {
    await opts.vault.mkdir(dir);
  } catch {
    /* best effort */
  }
  const listing = await listUserToolsDir(opts, dir);
  if (listing === null) return 0;
  let registered = 0;
  for (const raw of listing.files) {
    const path = raw.startsWith(`${dir}/`) ? raw : `${dir}/${raw}`;
    if (!path.endsWith('.json')) continue;
    if (await loadAndRegisterTool(path, opts)) registered += 1;
  }
  return registered;
}

async function listUserToolsDir(
  opts: UserToolsLoaderOptions,
  dir: string,
): Promise<{ readonly files: readonly string[]; readonly folders: readonly string[] } | null> {
  try {
    return await opts.vault.list(dir);
  } catch (err) {
    opts.logger?.warn('tool.user.load.error', {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function loadAndRegisterTool(path: string, opts: UserToolsLoaderOptions): Promise<boolean> {
  const parsed = await readAndParseDecl(path, opts);
  if (parsed === null) return false;
  if (opts.registry.lookup(parsed.id) !== undefined) {
    reportLoadError(opts, path, `id collision: "${parsed.id}"`);
    return false;
  }
  let spec: ToolSpec<unknown, unknown>;
  try {
    spec = buildSpec(parsed, opts);
  } catch (err) {
    reportLoadError(opts, path, err instanceof Error ? err.message : String(err));
    return false;
  }
  try {
    opts.registry.register(spec);
  } catch (err) {
    reportLoadError(opts, path, err instanceof Error ? err.message : String(err));
    return false;
  }
  opts.logger?.info('tool.user.load.ok', { toolId: spec.id, source: spec.source });
  return true;
}

async function readAndParseDecl(
  path: string,
  opts: UserToolsLoaderOptions,
): Promise<UserToolDeclaration | null> {
  let content: string;
  try {
    content = await opts.vault.read(path);
  } catch (err) {
    reportLoadError(opts, path, err instanceof Error ? err.message : String(err));
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    reportLoadError(
      opts,
      path,
      `invalid json: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const decl = parseDeclaration(parsed);
  if (!decl.ok) {
    reportLoadError(opts, path, decl.error);
    return null;
  }
  return decl.decl;
}

function reportLoadError(opts: UserToolsLoaderOptions, path: string, issue: string): void {
  opts.logger?.warn('tool.user.load.error', { path, error: issue });
  opts.notice?.notify(`Leo: skipped invalid user tool ${path} (${issue})`);
}

export function parseDeclaration(
  raw: unknown,
): { ok: true; decl: UserToolDeclaration } | { ok: false; error: string } {
  const baseCheck = parseDeclarationBase(raw);
  if (!baseCheck.ok) return baseCheck;
  const { id, description, parameters, requiresConfirmation, implObj } = baseCheck;
  const kind = implObj.kind;
  if (kind === 'vault-op') {
    return parseVaultOpDecl({ id, description, parameters, requiresConfirmation, implObj });
  }
  if (kind === 'js') {
    return parseJsDecl({ id, description, parameters, requiresConfirmation, implObj });
  }
  return { ok: false, error: `impl.kind must be "vault-op" or "js", got: ${JSON.stringify(kind)}` };
}

interface DeclBase {
  readonly ok: true;
  readonly id: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly requiresConfirmation: boolean | undefined;
  readonly implObj: Record<string, unknown>;
}

function parseDeclarationBase(raw: unknown): DeclBase | { ok: false; error: string } {
  if (raw === null || typeof raw !== 'object')
    return { ok: false, error: 'declaration must be an object' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0)
    return { ok: false, error: 'id must be a non-empty string' };
  if (typeof obj.description !== 'string')
    return { ok: false, error: 'description must be a string' };
  if (obj.parameters === null || typeof obj.parameters !== 'object') {
    return { ok: false, error: 'parameters must be an object (JSON Schema)' };
  }
  let requiresConfirmation: boolean | undefined;
  if (obj.requiresConfirmation !== undefined) {
    if (typeof obj.requiresConfirmation !== 'boolean') {
      return { ok: false, error: 'requiresConfirmation must be a boolean' };
    }
    requiresConfirmation = obj.requiresConfirmation;
  }
  const implRaw = obj.impl;
  if (implRaw === null || typeof implRaw !== 'object')
    return { ok: false, error: 'impl must be an object' };
  return {
    ok: true,
    id: obj.id,
    description: obj.description,
    parameters: obj.parameters as JsonSchema,
    requiresConfirmation,
    implObj: implRaw as Record<string, unknown>,
  };
}

interface DeclParsedFields {
  readonly id: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly requiresConfirmation: boolean | undefined;
  readonly implObj: Record<string, unknown>;
}

function parseVaultOpDecl(
  fields: DeclParsedFields,
): { ok: true; decl: UserToolDeclaration } | { ok: false; error: string } {
  const { id, description, parameters, requiresConfirmation, implObj } = fields;
  const op = implObj.op;
  if (op !== 'read' && op !== 'create' && op !== 'append') {
    return { ok: false, error: 'impl.op must be one of "read" | "create" | "append"' };
  }
  if (typeof implObj.pathArg !== 'string' || implObj.pathArg.length === 0) {
    return { ok: false, error: 'impl.pathArg must be a non-empty string' };
  }
  if (implObj.contentArg !== undefined && typeof implObj.contentArg !== 'string') {
    return { ok: false, error: 'impl.contentArg must be a string when present' };
  }
  if ((op === 'create' || op === 'append') && typeof implObj.contentArg !== 'string') {
    return { ok: false, error: `impl.contentArg is required for op=${op}` };
  }
  const decl: UserToolDeclaration = {
    id,
    description,
    parameters,
    ...(requiresConfirmation !== undefined ? { requiresConfirmation } : {}),
    impl: {
      kind: 'vault-op',
      op,
      pathArg: implObj.pathArg,
      ...(implObj.contentArg !== undefined ? { contentArg: implObj.contentArg } : {}),
    },
  };
  return { ok: true, decl };
}

function parseJsDecl(
  fields: DeclParsedFields,
): { ok: true; decl: UserToolDeclaration } | { ok: false; error: string } {
  const { id, description, parameters, requiresConfirmation, implObj } = fields;
  if (typeof implObj.source !== 'string' || implObj.source.length === 0) {
    return { ok: false, error: 'impl.source must be a non-empty string' };
  }
  const decl: UserToolDeclaration = {
    id,
    description,
    parameters,
    ...(requiresConfirmation !== undefined ? { requiresConfirmation } : {}),
    impl: { kind: 'js', source: implObj.source },
  };
  return { ok: true, decl };
}

export function buildSpec(
  decl: UserToolDeclaration,
  opts: UserToolsLoaderOptions,
): ToolSpec<unknown, unknown> {
  const effectiveConfirmation = deriveConfirmation(decl);
  const validate = (raw: unknown): ToolResult<Record<string, unknown>> => {
    if (raw === null || typeof raw !== 'object')
      return { ok: false, error: 'args must be an object' };
    return { ok: true, data: raw as Record<string, unknown> };
  };
  if (decl.impl.kind === 'vault-op') {
    const vaultOp = decl.impl;
    return {
      id: decl.id,
      description: decl.description,
      schema: permissiveUserSchema as z.ZodType<unknown>,
      parameters: decl.parameters,
      requiresConfirmation: effectiveConfirmation,
      source: 'user',
      validate,
      invoke: async (args, ctx) => invokeVaultOp(vaultOp, args, ctx, opts.vault),
    };
  }
  const js = decl.impl;
  let compiled: CompiledJsImpl;
  try {
    compiled = compileJs(js.source);
  } catch (err) {
    throw new Error(`compile failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    id: decl.id,
    description: decl.description,
    schema: permissiveUserSchema as z.ZodType<unknown>,
    parameters: decl.parameters,
    requiresConfirmation: true,
    source: 'user',
    validate,
    invoke: async (args, ctx) => invokeJs(compiled, args, ctx, opts),
  };
}

function deriveConfirmation(decl: UserToolDeclaration): boolean {
  if (decl.impl.kind === 'js') return true;
  if (decl.impl.op === 'read') return decl.requiresConfirmation ?? false;
  return decl.requiresConfirmation ?? true;
}

async function invokeVaultOp(
  impl: VaultOpDeclaration,
  args: unknown,
  ctx: ToolCtx,
  vault: VaultAdapter,
): Promise<ToolResult<unknown>> {
  if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
  const argsObj = (args ?? {}) as Record<string, unknown>;
  const path = argsObj[impl.pathArg];
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, error: `missing arg: ${impl.pathArg}` };
  }
  if (!isSafeVaultPath(path)) return { ok: false, error: 'unsafe path' };
  try {
    if (impl.op === 'read') {
      if (!(await vault.exists(path))) return { ok: false, error: `not found: ${path}` };
      const content = await vault.read(path);
      return { ok: true, data: { path, content } };
    }
    const contentKey = impl.contentArg ?? 'content';
    const content = argsObj[contentKey];
    if (typeof content !== 'string') return { ok: false, error: `missing arg: ${contentKey}` };
    if (impl.op === 'create') {
      if (await vault.exists(path)) return { ok: false, error: `already exists: ${path}` };
      await vault.write(path, content);
      return { ok: true, data: { path, bytes: content.length, op: 'create' } };
    }
    const prior = (await vault.exists(path)) ? await vault.read(path) : '';
    let joined: string;
    if (prior.length === 0) {
      joined = content;
    } else {
      const sep = prior.endsWith('\n') ? '' : '\n';
      joined = `${prior}${sep}${content}`;
    }
    await vault.write(path, joined);
    return { ok: true, data: { path, bytes: joined.length, op: 'append' } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function compileJs(source: string): CompiledJsImpl {
  const factory = new Function(
    'ctx',
    'args',
    `"use strict"; return (async function __leoUserTool(ctx, args) { ${source} })(ctx, args);`,
  ) as (ctx: Record<string, unknown>, args: unknown) => Promise<unknown>;
  return { fn: factory };
}

async function invokeJs(
  compiled: CompiledJsImpl,
  args: unknown,
  ctx: ToolCtx,
  opts: UserToolsLoaderOptions,
): Promise<ToolResult<unknown>> {
  if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
  const sandboxCtx: Record<string, unknown> = {
    vault: opts.vault,
    logger: ctx.logger ?? opts.logger ?? null,
    signal: ctx.signal,
    ...(opts.jsContext ?? {}),
  };
  try {
    const raw = await compiled.fn(sandboxCtx, args);
    if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
    if (raw !== null && typeof raw === 'object' && 'ok' in (raw as object)) {
      const r = raw as { ok: boolean; data?: unknown; error?: unknown };
      if (r.ok === true) return { ok: true, data: r.data };
      return { ok: false, error: typeof r.error === 'string' ? r.error : 'tool error' };
    }
    return { ok: true, data: raw };
  } catch (err) {
    if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
