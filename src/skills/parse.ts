import type { Skill, SkillExample, SkillParseResult, SkillSource } from './types';

export interface SkillParseOptions {
  readonly source: SkillSource;
}

export function parseSkillFile(
  contents: string,
  filename: string,
  opts: SkillParseOptions,
): SkillParseResult {
  if (filename.endsWith('.json')) return parseJsonSkill(contents, opts);
  if (filename.endsWith('.md')) return parseMarkdownSkill(contents, opts);
  return { ok: false, error: `unsupported skill file extension: ${filename}` };
}

function parseJsonSkill(contents: string, opts: SkillParseOptions): SkillParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return validateSkill(raw, opts);
}

function parseMarkdownSkill(contents: string, opts: SkillParseOptions): SkillParseResult {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(contents);
  if (match === null) {
    return { ok: false, error: 'markdown skill requires YAML frontmatter' };
  }
  const fm = match[1] ?? '';
  const body = (match[2] ?? '').replace(/^\s+/, '').trimEnd();
  const meta = parseSimpleYaml(fm);
  if (!meta.ok) return { ok: false, error: meta.error };
  const raw: Record<string, unknown> = { ...meta.value, systemPrompt: body };
  return validateSkill(raw, opts);
}

interface YamlParse {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}
interface YamlFailure {
  readonly ok: false;
  readonly error: string;
}

function parseSimpleYaml(text: string): YamlParse | YamlFailure {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) return { ok: false, error: `invalid YAML line: ${line}` };
    const key = line.slice(0, idx).trim();
    const valueRaw = line.slice(idx + 1).trim();
    if (key.length === 0) return { ok: false, error: 'empty YAML key' };
    out[key] = parseYamlValue(valueRaw);
  }
  return { ok: true, value: out };
}

function parseYamlValue(raw: string): unknown {
  if (raw.length === 0) return '';
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''));
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function validateSkill(raw: unknown, opts: SkillParseOptions): SkillParseResult {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: 'skill root must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || obj.id.length === 0)
    return { ok: false, error: 'id must be a non-empty string' };
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(obj.id))
    return { ok: false, error: `id must be slug-like: ${obj.id}` };
  if (typeof obj.name !== 'string' || obj.name.length === 0)
    return { ok: false, error: 'name must be a non-empty string' };
  if (typeof obj.description !== 'string')
    return { ok: false, error: 'description must be a string' };
  if (typeof obj.systemPrompt !== 'string' || obj.systemPrompt.length === 0)
    return { ok: false, error: 'systemPrompt must be a non-empty string' };
  const allowedTools = obj.allowedTools;
  if (allowedTools !== undefined) {
    if (!Array.isArray(allowedTools) || !allowedTools.every((x) => typeof x === 'string')) {
      return { ok: false, error: 'allowedTools must be string[]' };
    }
  }
  const defaultModel = obj.defaultModel;
  if (defaultModel !== undefined && typeof defaultModel !== 'string') {
    return { ok: false, error: 'defaultModel must be a string' };
  }
  const examples = obj.examples;
  let normalizedExamples: readonly SkillExample[] | undefined;
  if (examples !== undefined) {
    if (!Array.isArray(examples)) return { ok: false, error: 'examples must be an array' };
    const out: SkillExample[] = [];
    for (const entry of examples) {
      if (entry === null || typeof entry !== 'object')
        return { ok: false, error: 'invalid example' };
      const e = entry as Record<string, unknown>;
      if (typeof e.user !== 'string' || typeof e.assistant !== 'string') {
        return { ok: false, error: 'example requires string user + assistant' };
      }
      out.push({ user: e.user, assistant: e.assistant });
    }
    normalizedExamples = out;
  }
  const skill: Skill = {
    id: obj.id,
    name: obj.name,
    description: obj.description,
    systemPrompt: obj.systemPrompt,
    source: opts.source,
    ...(allowedTools !== undefined ? { allowedTools: allowedTools as readonly string[] } : {}),
    ...(normalizedExamples !== undefined ? { examples: normalizedExamples } : {}),
    ...(defaultModel !== undefined ? { defaultModel: defaultModel as string } : {}),
  };
  return { ok: true, skill };
}

export function serializeSkillJson(skill: Skill): string {
  const raw: Record<string, unknown> = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    systemPrompt: skill.systemPrompt,
  };
  if (skill.allowedTools !== undefined) raw.allowedTools = [...skill.allowedTools];
  if (skill.examples !== undefined) raw.examples = skill.examples.map((e) => ({ ...e }));
  if (skill.defaultModel !== undefined) raw.defaultModel = skill.defaultModel;
  return JSON.stringify(raw, null, 2);
}
