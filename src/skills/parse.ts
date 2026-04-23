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
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(source);
  if (match === null) {
    return { fields: {}, body: source.replace(/^\s+/, '') };
  }
  const yaml = match[1] ?? '';
  const body = (match[2] ?? '').replace(/^\s+/, '').trimEnd();
  const fields = parseSimpleYaml(yaml);
  return { fields, body };
}

export function parseSimpleYaml(text: string): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  let currentKey: string | null = null;
  let blockList: string[] | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.length === 0) continue;
    if (/^\s*#/.test(line)) continue;
    if (blockList !== null && /^\s+-\s+/.test(line)) {
      const item = line.replace(/^\s+-\s+/, '');
      blockList.push(stripQuotes(item));
      continue;
    }
    if (blockList !== null) {
      if (currentKey !== null) {
        out[currentKey] = blockList;
      }
      blockList = null;
      currentKey = null;
    }
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const valueRaw = line.slice(idx + 1).trim();
    if (key.length === 0) continue;
    if (valueRaw.length === 0) {
      currentKey = key;
      blockList = [];
      continue;
    }
    out[key] = parseScalar(valueRaw);
  }
  if (blockList !== null && currentKey !== null) {
    out[currentKey] = blockList;
  }
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

export function parseSkillMarkdown(source: string, opts: ParseSkillOptions): SkillParseResult {
  const { fields, body } = parseFrontmatter(source);
  if (body.length === 0) {
    return { ok: false, error: 'skill body is empty' };
  }

  const nameField = typeof fields['name'] === 'string' ? (fields['name'] as string) : undefined;
  const description = deriveDescription(fields, body);
  if (description === null) {
    return { ok: false, error: 'skill description is missing' };
  }
  const paths = asStringArray(fields['paths']);
  const normalizedPaths = paths !== undefined ? normalizePaths(paths) : undefined;
  const argumentNames = asStringArray(fields['arguments']);
  const allowedTools =
    asStringArray(fields['allowed-tools']) ?? asStringArray(fields['allowedTools']) ?? [];
  const whenToUse = pickString(fields, 'when_to_use', 'whenToUse');
  const argumentHint = pickString(fields, 'argument-hint', 'argumentHint');
  const modelRaw = pickString(fields, 'model');
  const model = modelRaw === 'inherit' ? undefined : modelRaw;
  const effort = parseEffort(fields['effort']);
  const context = parseContext(fields['context']);
  const agent = pickString(fields, 'agent');
  const version = pickString(fields, 'version');
  const shell = parseShellSpec(fields['shell']);
  const disableModelInvocation =
    pickBoolean(fields, 'disable-model-invocation', 'disableModelInvocation') ?? false;
  const userInvocable = pickBoolean(fields, 'user-invocable', 'userInvocable') ?? true;
  const aliases = asStringArray(fields['aliases']);

  const blueprint: SkillBlueprint = {
    name: opts.canonicalName,
    displayName: nameField ?? opts.canonicalName,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
    ...(argumentHint !== undefined ? { argumentHint } : {}),
    ...(argumentNames !== undefined ? { argNames: argumentNames } : {}),
    allowedTools,
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(context !== undefined ? { context } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(normalizedPaths !== undefined ? { paths: normalizedPaths } : {}),
    ...(shell !== undefined ? { shell } : {}),
    disableModelInvocation,
    userInvocable,
    ...(version !== undefined ? { version } : {}),
    body,
  };
  return { ok: true, skill: blueprint };
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

function parseShellSpec(value: unknown): ShellSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const match = /timeoutMs\s*:\s*(\d+)/.exec(value);
    if (match !== null) return { timeoutMs: Number.parseInt(match[1]!, 10) };
    return undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
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
