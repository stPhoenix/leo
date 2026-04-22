export interface ChunkTags {
  readonly frontmatter: readonly string[];
  readonly inline: readonly string[];
}

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

export function normalizeTags(raw: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const norm = normalizeTag(entry);
    if (norm.length === 0) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export function matches(chunkTags: ChunkTags, requested: readonly string[]): boolean {
  if (requested.length === 0) return true;
  const reqSet = new Set(normalizeTags(requested));
  if (reqSet.size === 0) return true;
  const frontmatter = chunkTags.frontmatter ?? [];
  for (const raw of frontmatter) {
    if (typeof raw !== 'string') continue;
    if (reqSet.has(normalizeTag(raw))) return true;
  }
  const inline = chunkTags.inline ?? [];
  for (const raw of inline) {
    if (typeof raw !== 'string') continue;
    if (reqSet.has(normalizeTag(raw))) return true;
  }
  return false;
}

export function compileTagPredicate(requested: readonly string[]): (tags: ChunkTags) => boolean {
  const normalised = normalizeTags(requested);
  if (normalised.length === 0) return (): boolean => true;
  const reqSet = new Set(normalised);
  return (tags: ChunkTags): boolean => {
    const frontmatter = tags.frontmatter ?? [];
    for (const raw of frontmatter) {
      if (typeof raw !== 'string') continue;
      if (reqSet.has(normalizeTag(raw))) return true;
    }
    const inline = tags.inline ?? [];
    for (const raw of inline) {
      if (typeof raw !== 'string') continue;
      if (reqSet.has(normalizeTag(raw))) return true;
    }
    return false;
  };
}
