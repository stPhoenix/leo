import { computeSha256Hex } from '@/agent/wiki/ingest/sha256';

const SLUG_REPLACE_RE = /[^a-z0-9]+/g;

function leafBaseName(vaultPath: string): string {
  const tail = vaultPath.split('/').pop() ?? '';
  return tail.replace(/\.canvas$/i, '');
}

function kebabize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(SLUG_REPLACE_RE, '-')
    .replace(/^-+|-+$/g, '');
}

export async function canvasPathToSidecarSlug(vaultPath: string): Promise<string> {
  const kebab = kebabize(leafBaseName(vaultPath)) || 'canvas';
  const hex = await computeSha256Hex(vaultPath);
  return `${kebab}-${hex.slice(0, 6)}`;
}

export interface ParsedSidecarSlug {
  readonly leaf: string;
  readonly suffix: string;
}

export function parseSidecarSlug(slug: string): ParsedSidecarSlug | null {
  const match = /^(.+)-([0-9a-f]{6})$/.exec(slug);
  if (match === null) return null;
  return { leaf: match[1] ?? '', suffix: match[2] ?? '' };
}
