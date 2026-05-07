import type { VaultAdapter } from '@/storage/vaultAdapter';
import { WIKI_RAW_DIR } from '@/agent/wiki/paths';
import type { DuplicateMatch } from './types';

export async function findDuplicateRawBySha(
  vault: VaultAdapter,
  sha256: string,
): Promise<DuplicateMatch | null> {
  if (!(await vault.exists(WIKI_RAW_DIR))) return null;
  let listing;
  try {
    listing = await vault.list(WIKI_RAW_DIR);
  } catch {
    return null;
  }
  for (const path of listing.files) {
    if (!path.endsWith('.md')) continue;
    let body: string;
    try {
      body = await vault.read(path);
    } catch {
      continue;
    }
    const fm = parseFrontmatterFields(body, ['sha256', 'fetched_at']);
    if (fm.sha256 === sha256) {
      return {
        rawPath: path,
        sha256,
        fetchedAt: fm.fetched_at ?? '',
      };
    }
  }
  return null;
}

function parseFrontmatterFields(
  body: string,
  fields: readonly string[],
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return out;
  const wanted = new Set(fields);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') break;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line); // NOSONAR(typescript:S5852): anchored YAML key:value, char class + lazy capture, linear per line.
    if (m === null) continue;
    if (wanted.has(m[1] ?? '')) {
      out[m[1]!] = (m[2] ?? '').replace(/^["']|["']$/g, '');
    }
  }
  return out;
}
