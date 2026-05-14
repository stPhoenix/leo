// Parses SKILL.md per doc §3. Frontmatter is YAML-like but intentionally small:
// top-level scalar, boolean, number, inline array, or block list ("- item" lines).
// Object values are captured as raw strings and ignored unless a later stage
// claims them.

import type {
  EffortValue,
  ShellSpec,
  SkillArgument,
  SkillBlueprint,
  SkillContext,
  SkillParseResult,
} from './types';

export interface ParsedFrontmatter {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly body: string;
}

export function parseFrontmatter(source: string): ParsedFrontmatter {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(source); // NOSONAR(typescript:S5852): anchored frontmatter, lazy capture bounded by literal `\n---`, linear.
  if (match === null) {
    return { fields: {}, body: source.replace(/^\s+/, '') };
  }
  const yaml = match[1] ?? '';
  const body = (match[2] ?? '').replace(/^\s+/, '').trimEnd();
  const fields = parseSimpleYaml(yaml);
  return { fields, body };
}

interface YamlState {
  currentKey: string | null;
  blockList: string[] | null;
}

function flushBlockList(state: YamlState, out: Record<string, unknown>): void {
  if (state.blockList === null) return;
  if (state.currentKey !== null) out[state.currentKey] = state.blockList;
  state.blockList = null;
  state.currentKey = null;
}

function applyKeyValueLine(line: string, state: YamlState, out: Record<string, unknown>): void {
  const idx = line.indexOf(':');
  if (idx < 0) return;
  const key = line.slice(0, idx).trim();
  const valueRaw = line.slice(idx + 1).trim();
  if (key.length === 0) return;
  if (valueRaw.length === 0) {
    state.currentKey = key;
    state.blockList = [];
    return;
  }
  out[key] = parseScalar(valueRaw);
}

function isSkippableLine(line: string): boolean {
  return line.length === 0 || /^\s*#/.test(line);
}

export function parseSimpleYaml(text: string): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  const state: YamlState = { currentKey: null, blockList: null };
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, ''); // NOSONAR(typescript:S5852): anchored trailing-whitespace trim, linear.
    if (isSkippableLine(line)) continue;
    if (state.blockList !== null && /^\s+-\s+/.test(line)) {
      state.blockList.push(stripQuotes(line.replace(/^\s+-\s+/, '')));
      continue;
    }
    flushBlockList(state, out);
    applyKeyValueLine(line, state, out);
  }
  flushBlockList(state, out);
  return out;
}

function parseScalar(raw: string): unknown {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((s) => stripQuotes(s.trim()));
  }
  if (raw.startsWith('{') && raw.endsWith('}')) {
    return raw;
  }
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  return stripQuotes(raw);
}

function stripQuotes(raw: string): string {
  if (raw.length < 2) return raw;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

export interface ParseSkillOptions {
  readonly canonicalName: string;
}

interface SkillFieldExtract {
  readonly nameField: string | undefined;
  readonly description: string;
  readonly paths: readonly string[] | undefined;
  readonly normalizedPaths: readonly string[] | undefined;
  readonly argumentNames: readonly string[] | undefined;
  readonly allowedTools: readonly string[];
  readonly whenToUse: string | undefined;
  readonly argumentHint: string | undefined;
  readonly model: string | undefined;
  readonly effort: EffortValue | undefined;
  readonly context: SkillContext | undefined;
  readonly agent: string | undefined;
  readonly version: string | undefined;
  readonly shell: ShellSpec | undefined;
  readonly disableModelInvocation: boolean;
  readonly userInvocable: boolean;
  readonly aliases: readonly string[] | undefined;
}

function extractSkillFields(
  fields: Readonly<Record<string, unknown>>,
  description: string,
): SkillFieldExtract {
  const paths = asStringArray(fields['paths']);
  const modelRaw = pickString(fields, 'model');
  return {
    nameField: typeof fields['name'] === 'string' ? (fields['name'] as string) : undefined,
    description,
    paths,
    normalizedPaths: paths !== undefined ? normalizePaths(paths) : undefined,
    argumentNames: asStringArray(fields['arguments']),
    allowedTools:
      asStringArray(fields['allowed-tools']) ?? asStringArray(fields['allowedTools']) ?? [],
    whenToUse: pickString(fields, 'when_to_use', 'whenToUse'),
    argumentHint: pickString(fields, 'argument-hint', 'argumentHint'),
    model: modelRaw === 'inherit' ? undefined : modelRaw,
    effort: parseEffort(fields['effort']),
    context: parseContext(fields['context']),
    agent: pickString(fields, 'agent'),
    version: pickString(fields, 'version'),
    shell: parseShellSpec(fields['shell']),
    disableModelInvocation:
      pickBoolean(fields, 'disable-model-invocation', 'disableModelInvocation') ?? false,
    userInvocable: pickBoolean(fields, 'user-invocable', 'userInvocable') ?? true,
    aliases: asStringArray(fields['aliases']),
  };
}

function buildBlueprint(e: SkillFieldExtract, canonicalName: string, body: string): SkillBlueprint {
  return {
    name: canonicalName,
    displayName: e.nameField ?? canonicalName,
    description: e.description,
    ...(e.whenToUse !== undefined ? { whenToUse: e.whenToUse } : {}),
    ...(e.aliases !== undefined ? { aliases: e.aliases } : {}),
    ...(e.argumentHint !== undefined ? { argumentHint: e.argumentHint } : {}),
    ...(e.argumentNames !== undefined ? { argNames: e.argumentNames } : {}),
    allowedTools: e.allowedTools,
    ...(e.model !== undefined ? { model: e.model } : {}),
    ...(e.effort !== undefined ? { effort: e.effort } : {}),
    ...(e.context !== undefined ? { context: e.context } : {}),
    ...(e.agent !== undefined ? { agent: e.agent } : {}),
    ...(e.normalizedPaths !== undefined ? { paths: e.normalizedPaths } : {}),
    ...(e.shell !== undefined ? { shell: e.shell } : {}),
    disableModelInvocation: e.disableModelInvocation,
    userInvocable: e.userInvocable,
    ...(e.version !== undefined ? { version: e.version } : {}),
    body,
  };
}

export function parseSkillMarkdown(source: string, opts: ParseSkillOptions): SkillParseResult {
  const { fields, body } = parseFrontmatter(source);
  if (body.length === 0) return { ok: false, error: 'skill body is empty' };
  const description = deriveDescription(fields, body);
  if (description === null) return { ok: false, error: 'skill description is missing' };
  const extracted = extractSkillFields(fields, description);
  return { ok: true, skill: buildBlueprint(extracted, opts.canonicalName, body) };
}

function deriveDescription(fields: Readonly<Record<string, unknown>>, body: string): string | null {
  const declared =
    typeof fields['description'] === 'string' ? (fields['description'] as string) : '';
  if (declared.trim().length > 0) return declared.trim();
  const firstSentence = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))[0];
  if (firstSentence === undefined) return null;
  const end = firstSentence.match(/[.!?]/)?.index;
  return end !== undefined ? firstSentence.slice(0, end + 1) : firstSentence;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) out.push(item);
  }
  return out;
}

function pickString(
  fields: Readonly<Record<string, unknown>>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function pickBoolean(
  fields: Readonly<Record<string, unknown>>,
  ...keys: string[]
): boolean | undefined {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function parseEffort(value: unknown): EffortValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value === 'low' || value === 'medium' || value === 'high') return value;
    const asNumber = Number.parseInt(value, 10);
    if (!Number.isNaN(asNumber)) return asNumber;
  }
  return undefined;
}

function parseContext(value: unknown): SkillContext | undefined {
  if (value === 'fork' || value === 'inline') return value;
  return undefined;
}

function parseShellSpecFromString(value: string): ShellSpec | undefined {
  const match = /timeoutMs\s*:\s*(\d+)/.exec(value);
  if (match === null) return undefined;
  return { timeoutMs: Number.parseInt(match[1]!, 10) };
}

function parseShellSpecFromObject(obj: Record<string, unknown>): ShellSpec | undefined {
  const timeout = typeof obj['timeoutMs'] === 'number' ? (obj['timeoutMs'] as number) : undefined;
  const allowed = Array.isArray(obj['allowedCommands'])
    ? (obj['allowedCommands'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined;
  if (timeout === undefined && allowed === undefined) return undefined;
  return {
    ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
    ...(allowed !== undefined ? { allowedCommands: allowed } : {}),
  };
}

function parseShellSpec(value: unknown): ShellSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return parseShellSpecFromString(value);
  if (typeof value === 'object') return parseShellSpecFromObject(value as Record<string, unknown>);
  return undefined;
}

export function normalizePaths(paths: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const raw of paths) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed === '**' || trimmed === '**/*') continue;
    out.push(trimmed.endsWith('/**') ? trimmed.slice(0, -3) : trimmed);
  }
  return out;
}

// Stable helper kept to ease tests that want to pull a single argument name.
export function getArgument(blueprint: SkillBlueprint, index: number): SkillArgument | undefined {
  const name = blueprint.argNames?.[index];
  if (name === undefined) return undefined;
  return { name };
}
