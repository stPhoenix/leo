import { minimatch } from 'minimatch';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { CANVAS_BUDGETS } from './budgets';
import type { SourceHint } from './schemas';

export type CanvasSourceKind = 'url' | 'vaultPath' | 'attachment' | 'conversation';

export interface CanvasSourceItem {
  readonly kind: CanvasSourceKind;
  readonly resolvedRef: string;
  readonly hint: SourceHint;
  readonly note?: string;
  readonly conversation?: { readonly title: string; readonly body: string };
}

export interface CachedFileMetadata {
  readonly tags?: ReadonlyArray<{ tag: string }>;
  readonly frontmatter?: Readonly<Record<string, unknown>>;
}

export interface CanvasMetadataCacheLike {
  readonly getFileCache: (file: { readonly path: string }) => CachedFileMetadata | null;
  readonly getTagFiles?: (tag: string) => readonly string[];
  readonly getFirstLinkpathDest?: (
    linkpath: string,
    sourcePath: string,
  ) => { readonly path: string } | null;
}

export interface ExpandSourceHintsInput {
  readonly hints: readonly SourceHint[];
  readonly vault: VaultAdapter;
  readonly metadataCache?: CanvasMetadataCacheLike;
  readonly fanoutMax?: number;
}

export interface ExpandSourceHintsResult {
  readonly items: readonly CanvasSourceItem[];
  readonly droppedCount: number;
}

const KIND_ORDER: Readonly<Record<SourceHint['kind'], number>> = {
  mention: 0,
  url: 1,
  vaultGlob: 2,
  vaultTag: 3,
  vaultFrontmatter: 4,
  attachment: 5,
  conversation: 6,
};

export async function expandSourceHints(
  input: ExpandSourceHintsInput,
): Promise<ExpandSourceHintsResult> {
  const fanoutMax = input.fanoutMax ?? CANVAS_BUDGETS.sourceFanoutMax;
  const collected: CanvasSourceItem[] = [];

  for (const hint of input.hints) {
    const items = await expandSingle(hint, input);
    collected.push(...items);
  }

  collected.sort((a, b) => {
    const ko = KIND_ORDER[a.hint.kind] - KIND_ORDER[b.hint.kind];
    if (ko !== 0) return ko;
    return a.resolvedRef.localeCompare(b.resolvedRef);
  });

  const seen = new Set<string>();
  const deduped: CanvasSourceItem[] = [];
  for (const item of collected) {
    const key = `${item.kind}::${item.resolvedRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const total = deduped.length;
  const kept = deduped.slice(0, fanoutMax);
  return { items: kept, droppedCount: Math.max(0, total - kept.length) };
}

async function expandSingle(
  hint: SourceHint,
  input: ExpandSourceHintsInput,
): Promise<CanvasSourceItem[]> {
  switch (hint.kind) {
    case 'mention':
      return [{ kind: 'vaultPath', resolvedRef: hint.path, hint }];
    case 'url':
      return [{ kind: 'url', resolvedRef: hint.url, hint }];
    case 'attachment':
      return [{ kind: 'attachment', resolvedRef: hint.attachmentId, hint }];
    case 'conversation':
      return [
        {
          kind: 'conversation',
          resolvedRef: hint.title,
          hint,
          conversation: { title: hint.title, body: hint.body },
        },
      ];
    case 'vaultGlob':
      return await expandGlob(hint, input);
    case 'vaultTag':
      return expandTag(hint, input);
    case 'vaultFrontmatter':
      return await expandFrontmatter(hint, input);
  }
}

async function expandGlob(
  hint: Extract<SourceHint, { kind: 'vaultGlob' }>,
  input: ExpandSourceHintsInput,
): Promise<CanvasSourceItem[]> {
  const allFiles = await collectAllVaultFiles(input.vault);
  const matched = allFiles.filter((p) => minimatch(p, hint.glob, { dot: true, matchBase: false }));
  return matched.map((p) => ({ kind: 'vaultPath', resolvedRef: p, hint }));
}

function expandTag(
  hint: Extract<SourceHint, { kind: 'vaultTag' }>,
  input: ExpandSourceHintsInput,
): CanvasSourceItem[] {
  const cache = input.metadataCache;
  if (cache?.getTagFiles === undefined) return [];
  const normalized = hint.tag.startsWith('#') ? hint.tag : `#${hint.tag}`;
  const files = cache.getTagFiles(normalized);
  return files.map((p) => ({ kind: 'vaultPath', resolvedRef: p, hint }));
}

async function expandFrontmatter(
  hint: Extract<SourceHint, { kind: 'vaultFrontmatter' }>,
  input: ExpandSourceHintsInput,
): Promise<CanvasSourceItem[]> {
  const cache = input.metadataCache;
  if (cache === undefined) return [];
  const allFiles = await collectAllVaultFiles(input.vault);
  const matched: string[] = [];
  for (const path of allFiles) {
    const meta = cache.getFileCache({ path });
    const fm = meta?.frontmatter;
    if (fm === undefined) continue;
    const value = fm[hint.field];
    if (Array.isArray(value)) {
      if (value.some((v) => v === hint.value)) matched.push(path);
      continue;
    }
    if (value === hint.value) matched.push(path);
  }
  return matched.map((p) => ({ kind: 'vaultPath', resolvedRef: p, hint }));
}

async function collectAllVaultFiles(vault: VaultAdapter): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [''];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let listing;
    try {
      listing = await vault.list(dir);
    } catch {
      continue;
    }
    for (const f of listing.files) out.push(f);
    for (const d of listing.folders) queue.push(d);
  }
  out.sort();
  return out;
}
