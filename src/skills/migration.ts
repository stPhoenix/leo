// One-time migration: legacy flat `.leo/skills/<id>.{json,md}` layout to doc
// `.leo/skills/<id>/SKILL.md`. Runs inside SkillsStore.loadAll().

import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';

export interface MigrationOptions {
  readonly vault: VaultAdapter;
  readonly dir: string;
  readonly logger?: Logger;
  readonly noticeChannel?: { notify(message: string): void } | null;
}

interface LegacyExamplePair {
  readonly user: string;
  readonly assistant: string;
}

interface LegacyPayload {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly systemPrompt?: string;
  readonly allowedTools?: readonly string[];
  readonly defaultModel?: string;
  readonly examples?: readonly LegacyExamplePair[];
}

async function migrateOneLegacyFile(opts: MigrationOptions, rawPath: string): Promise<boolean> {
  const fileName = rawPath.split('/').pop() ?? rawPath;
  if (fileName === 'SKILL.md') return false;
  const fullPath = rawPath.startsWith(`${opts.dir}/`) ? rawPath : `${opts.dir}/${fileName}`;
  try {
    const content = await opts.vault.read(fullPath);
    const payload = decodeLegacy(content, fileName);
    if (payload === null) return false;
    const folder = `${opts.dir}/${payload.id}`;
    const target = `${folder}/SKILL.md`;
    if (await opts.vault.exists(target)) {
      await opts.vault.remove(fullPath);
      return false;
    }
    await opts.vault.mkdir(folder);
    await opts.vault.write(target, renderSkillMarkdown(payload));
    await opts.vault.remove(fullPath);
    return true;
  } catch (err) {
    opts.logger?.warn('skills.migrate.file-failed', {
      path: fullPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function migrateLegacySkills(opts: MigrationOptions): Promise<void> {
  let listing: { readonly files: readonly string[]; readonly folders: readonly string[] };
  try {
    listing = await opts.vault.list(opts.dir);
  } catch {
    return;
  }
  const flatFiles = listing.files.filter((path) => {
    const name = path.split('/').pop() ?? path;
    return name.endsWith('.json') || (name.endsWith('.md') && name !== 'SKILL.md');
  });
  if (flatFiles.length === 0) return;
  let migrated = 0;
  for (const rawPath of flatFiles) {
    if (await migrateOneLegacyFile(opts, rawPath)) migrated += 1;
  }
  if (migrated > 0) {
    opts.logger?.info('skills.migrate.done', { migrated });
    opts.noticeChannel?.notify(
      `Leo: migrated ${migrated} legacy skill file(s) to SKILL.md layout.`,
    );
  }
}

function decodeLegacy(content: string, fileName: string): LegacyPayload | null {
  if (fileName.endsWith('.json')) {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return normalizeLegacy(parsed, fileName);
    } catch {
      return null;
    }
  }
  if (fileName.endsWith('.md')) {
    const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(content); // NOSONAR(typescript:S5852): anchored frontmatter, lazy capture bounded by literal `\n---`, linear.
    if (match === null) return null;
    const fm = parseFlatYaml(match[1] ?? '');
    fm['systemPrompt'] = (match[2] ?? '').trimStart();
    return normalizeLegacy(fm, fileName);
  }
  return null;
}

function normalizeLegacy(raw: Record<string, unknown>, fileName: string): LegacyPayload | null {
  const id =
    typeof raw['id'] === 'string' ? (raw['id'] as string) : fileName.replace(/\.(json|md)$/i, '');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return null;
  const payload: LegacyPayload = {
    id,
    ...(typeof raw['name'] === 'string' ? { name: raw['name'] as string } : {}),
    ...(typeof raw['description'] === 'string'
      ? { description: raw['description'] as string }
      : {}),
    ...(typeof raw['systemPrompt'] === 'string'
      ? { systemPrompt: raw['systemPrompt'] as string }
      : {}),
    ...(typeof raw['defaultModel'] === 'string'
      ? { defaultModel: raw['defaultModel'] as string }
      : {}),
    ...(Array.isArray(raw['allowedTools'])
      ? {
          allowedTools: (raw['allowedTools'] as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          ),
        }
      : {}),
    ...(Array.isArray(raw['examples'])
      ? { examples: normalizeExamples(raw['examples'] as unknown[]) }
      : {}),
  };
  return payload;
}

function normalizeExamples(raw: readonly unknown[]): readonly LegacyExamplePair[] {
  const out: LegacyExamplePair[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry['user'] === 'string' && typeof entry['assistant'] === 'string') {
      out.push({ user: entry['user'] as string, assistant: entry['assistant'] as string });
    }
  }
  return out;
}

function parseFlatYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      out[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter((s) => s.length > 0);
    } else {
      out[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

function renderSkillMarkdown(payload: LegacyPayload): string {
  const fmLines: string[] = ['---'];
  fmLines.push(`name: ${escapeYaml(payload.name ?? payload.id)}`);
  fmLines.push(`description: ${escapeYaml(payload.description ?? '')}`);
  if (payload.allowedTools !== undefined && payload.allowedTools.length > 0) {
    fmLines.push(`allowed-tools: [${payload.allowedTools.map(escapeYaml).join(', ')}]`);
  }
  if (payload.defaultModel !== undefined) {
    fmLines.push(`model: ${escapeYaml(payload.defaultModel)}`);
  }
  fmLines.push('---');
  const bodyParts: string[] = [];
  if (payload.systemPrompt !== undefined && payload.systemPrompt.length > 0) {
    bodyParts.push(payload.systemPrompt.trim());
  }
  if (payload.examples !== undefined && payload.examples.length > 0) {
    bodyParts.push('\n## Examples');
    for (const e of payload.examples) {
      bodyParts.push(`- User: ${e.user}\n  Assistant: ${e.assistant}`);
    }
  }
  return `${fmLines.join('\n')}\n${bodyParts.join('\n\n')}\n`;
}

function escapeYaml(value: string): string {
  if (value.length === 0) return '""';
  if (/[:#[\]{},&*!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}
