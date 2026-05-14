import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { Entity, EntityGraph } from './schemas';
import type { CanvasMetadataCacheLike } from './plan';
import type { FetchedCanvasItem } from './fetch';
import { SLUG_FUNCTION_WORDS } from './slugWords';

export interface ResolveEntityFilesInput {
  readonly graph: EntityGraph;
  readonly fetched: readonly FetchedCanvasItem[];
  readonly metadataCache?: CanvasMetadataCacheLike;
  /**
   * Optional broad slug→vaultPath index, e.g. all `.md` basenames under
   * `wiki/pages`. Consulted after the per-fetch basename map misses, so
   * text-only entities can still bind to existing wiki pages even when the
   * extractor never received them as a source hint.
   */
  readonly pageBasenames?: ReadonlyMap<string, string>;
}

export function resolveEntityFiles(input: ResolveEntityFilesInput): EntityGraph {
  const basenameMap = buildBasenameMap(input.fetched);
  const anchor = pickAnchorPath(input.fetched);
  const resolver = input.metadataCache?.getFirstLinkpathDest;
  const pageBasenames = input.pageBasenames;

  const ctx: FirstChoiceCtx = { basenameMap, anchor, resolver, pageBasenames };
  const firstChoice = buildFirstChoiceMap(input.graph.entities, ctx);
  const preferredOwner = computePreferredOwners(firstChoice);
  const claimed = collectClaimedPaths(input.graph.entities);

  const tryClaim = (path: string, entityId: string): string | null => {
    if (claimed.has(path)) return null;
    const owner = preferredOwner.get(path);
    if (owner !== undefined && owner !== entityId) return null;
    claimed.add(path);
    return path;
  };

  const tryAssign = (ent: Entity, candidate: string): Entity | null => {
    const claimedPath = tryClaim(candidate, ent.id);
    return claimedPath !== null ? { ...ent, filePath: claimedPath } : null;
  };

  const tryDefinedIn = (ent: Entity): Entity | null => {
    if (ent.definedIn === undefined) return null;
    const viaDefined = resolveDefinedInPath(ent.definedIn, pageBasenames);
    if (viaDefined === null || !definedInRelatesToEntity(viaDefined, ent)) return null;
    return tryAssign(ent, viaDefined);
  };

  const tryResolver = (ent: Entity): Entity | null => {
    const viaResolver = resolver?.(ent.name, anchor);
    if (viaResolver === null || viaResolver === undefined || viaResolver.path.length === 0)
      return null;
    return tryAssign(ent, viaResolver.path);
  };

  const trySlugMaps = (ent: Entity): Entity | null => {
    const slugCandidates = candidateSlugs(ent.name);
    for (const slug of slugCandidates) {
      const path = basenameMap.get(slug);
      if (path !== undefined) {
        const next = tryAssign(ent, path);
        if (next !== null) return next;
      }
    }
    if (pageBasenames === undefined) return null;
    const idSlug = ent.id.includes(':') ? ent.id.slice(ent.id.indexOf(':') + 1) : '';
    const slugs = idSlug.length > 0 ? [...slugCandidates, idSlug] : slugCandidates;
    for (const slug of slugs) {
      const path = pageBasenames.get(slug);
      if (path !== undefined) {
        const next = tryAssign(ent, path);
        if (next !== null) return next;
      }
    }
    return null;
  };

  const resolveOne = (ent: Entity): Entity => {
    if (ent.filePath !== undefined) return ent;
    if (looksLikeUrl(ent.name)) return ent;
    if (ent.type === 'url') return ent;
    return tryDefinedIn(ent) ?? tryResolver(ent) ?? trySlugMaps(ent) ?? ent;
  };

  const nextEntities: Entity[] = input.graph.entities.map(resolveOne);

  return { ...input.graph, entities: nextEntities };
}

function buildFirstChoiceMap(
  entities: readonly Entity[],
  ctx: FirstChoiceCtx,
): Map<string, string> {
  const firstChoice = new Map<string, string>();
  for (const ent of entities) {
    const candidate = computeFirstChoice(ent, ctx);
    if (candidate !== null) firstChoice.set(ent.id, candidate);
  }
  return firstChoice;
}

function computePreferredOwners(firstChoice: ReadonlyMap<string, string>): Map<string, string> {
  const groupedByPath = new Map<string, string[]>();
  for (const [eid, path] of firstChoice) {
    const list = groupedByPath.get(path);
    if (list === undefined) groupedByPath.set(path, [eid]);
    else list.push(eid);
  }
  const preferredOwner = new Map<string, string>();
  for (const [path, ids] of groupedByPath) {
    if (ids.length < 2) continue;
    const baseSlugs = new Set(candidateSlugs(vaultBasename(path)));
    for (const id of ids) {
      const idSlug = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
      if (baseSlugs.has(idSlug)) {
        preferredOwner.set(path, id);
        break;
      }
    }
  }
  return preferredOwner;
}

function collectClaimedPaths(entities: readonly Entity[]): Set<string> {
  const claimed = new Set<string>();
  for (const ent of entities) {
    if (ent.filePath !== undefined) claimed.add(ent.filePath);
  }
  return claimed;
}

interface FirstChoiceCtx {
  readonly basenameMap: ReadonlyMap<string, string>;
  readonly anchor: string;
  readonly resolver: CanvasMetadataCacheLike['getFirstLinkpathDest'] | undefined;
  readonly pageBasenames?: ReadonlyMap<string, string>;
}

function computeFirstChoice(ent: Entity, ctx: FirstChoiceCtx): string | null {
  if (ent.filePath !== undefined) return ent.filePath;
  if (looksLikeUrl(ent.name)) return null;
  if (ent.type === 'url') return null;
  return (
    firstChoiceViaDefinedIn(ent, ctx) ??
    firstChoiceViaResolver(ent, ctx) ??
    firstChoiceViaSlugs(ent, ctx)
  );
}

function firstChoiceViaDefinedIn(ent: Entity, ctx: FirstChoiceCtx): string | null {
  if (ent.definedIn === undefined) return null;
  const viaDefined = resolveDefinedInPath(ent.definedIn, ctx.pageBasenames);
  if (viaDefined === null || !definedInRelatesToEntity(viaDefined, ent)) return null;
  return viaDefined;
}

function firstChoiceViaResolver(ent: Entity, ctx: FirstChoiceCtx): string | null {
  const viaResolver = ctx.resolver?.(ent.name, ctx.anchor);
  if (viaResolver === null || viaResolver === undefined || viaResolver.path.length === 0) {
    return null;
  }
  return viaResolver.path;
}

function firstChoiceViaSlugs(ent: Entity, ctx: FirstChoiceCtx): string | null {
  const slugCandidates = candidateSlugs(ent.name);
  for (const slug of slugCandidates) {
    const path = ctx.basenameMap.get(slug);
    if (path !== undefined) return path;
  }
  if (ctx.pageBasenames === undefined) return null;
  const idSlug = ent.id.includes(':') ? ent.id.slice(ent.id.indexOf(':') + 1) : '';
  const slugs = idSlug.length > 0 ? [...slugCandidates, idSlug] : slugCandidates;
  for (const slug of slugs) {
    const path = ctx.pageBasenames.get(slug);
    if (path !== undefined) return path;
  }
  return null;
}

/**
 * Build a slug→vaultPath index by recursively listing `.md` files under each
 * given directory. Used to extend `resolveEntityFiles` beyond the per-run
 * fetched sources so existing wiki pages bind to canvas entities even when
 * not passed as source hints.
 */
export async function buildPageBasenameMap(
  vault: VaultAdapter,
  dirs: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const dir of dirs) {
    await walkAndIndex(vault, dir, map);
  }
  return map;
}

/**
 * Resolve an `Entity.definedIn` value to a vault path when possible.
 * - Already a `.md` vault path → return as-is.
 * - URL → null (caller treats as text node).
 * - Slug fragment → look up in `pageBasenames`.
 * - Wikilink wrapper `[[…]]` → strip and re-attempt slug match.
 * Returns null when no vault page resolves.
 */
export function resolveDefinedInPath(
  raw: string,
  pageBasenames?: ReadonlyMap<string, string>,
): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;
  const stripped = trimmed.replace(/^\[\[/, '').replace(/\]\]$/, '');
  if (/\.md$/i.test(stripped) && stripped.includes('/')) return stripped;
  const noMd = stripped.replace(/\.md$/i, '');
  if (noMd.length === 0) return null;
  if (pageBasenames !== undefined) {
    for (const slug of candidateSlugs(noMd)) {
      const path = pageBasenames.get(slug);
      if (path !== undefined) return path;
    }
  }
  return null;
}

async function walkAndIndex(
  vault: VaultAdapter,
  dir: string,
  map: Map<string, string>,
): Promise<void> {
  let listing: { files: readonly string[]; folders: readonly string[] };
  try {
    listing = await vault.list(dir);
  } catch {
    return;
  }
  for (const filePath of listing.files) {
    if (!/\.md$/i.test(filePath)) continue;
    const basename = vaultBasename(filePath);
    if (basename === '') continue;
    for (const slug of candidateSlugs(basename)) {
      if (!map.has(slug)) map.set(slug, filePath);
    }
  }
  for (const sub of listing.folders) {
    await walkAndIndex(vault, sub, map);
  }
}

function buildBasenameMap(items: readonly FetchedCanvasItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.source.kind !== 'vaultPath') continue;
    if (item.status !== 'fetched') continue;
    const path = item.source.resolvedRef;
    const basename = vaultBasename(path);
    if (basename === '') continue;
    const slug = slugify(basename);
    if (slug === '') continue;
    if (!map.has(slug)) map.set(slug, path);
  }
  return map;
}

function pickAnchorPath(items: readonly FetchedCanvasItem[]): string {
  for (const item of items) {
    if (item.source.kind === 'vaultPath' && item.status === 'fetched') {
      return item.source.resolvedRef;
    }
  }
  return '';
}

function vaultBasename(path: string): string {
  const slash = path.lastIndexOf('/');
  const tail = slash >= 0 ? path.slice(slash + 1) : path;
  return tail.replace(/\.md$/i, '');
}

function candidateSlugs(name: string): string[] {
  const trimmed = name.replace(/^\[\[|\]\]$/g, '').replace(/\.md$/i, '');
  const out: string[] = [];
  const direct = slugify(trimmed);
  if (direct.length > 0) out.push(direct);
  const stripped = stripCommonPrefixes(direct);
  if (stripped.length > 0 && stripped !== direct) out.push(stripped);
  return out;
}

function stripCommonPrefixes(slug: string): string {
  let s = slug;
  s = stripIfNonEmpty(s, /^thou-shalt-(not-)?/);
  s = stripIfNonEmpty(s, /^(the|a|an)-/);
  return s;
}

function stripIfNonEmpty(s: string, re: RegExp): string {
  const after = s.replace(re, '');
  return after.length === 0 ? s : after;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-') // NOSONAR(typescript:S5852): single char class + quantifier, linear.
    .replace(/^-+|-+$/g, ''); // NOSONAR(typescript:S5852): anchored alternation over single-char class, linear.
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/**
 * Token-overlap sanity check on an LLM-emitted `definedIn` link. The extractor
 * sometimes emits a `definedIn` pointing at a different entity's page (e.g. a
 * parable entity bound to a casebook entry's wiki file). Without this gate,
 * `resolveEntityFiles` would render the entity's `{type:"file"}` node on the
 * wrong page. Refuse the binding when the resolved file's basename slug shares
 * zero non-function tokens with the entity's name slug; the entity then falls
 * through to its own slug strategies (or stays text-only).
 *
 * Conservative: only blocks obvious cross-wires.
 */
function definedInRelatesToEntity(resolvedPath: string, ent: Entity): boolean {
  const baseTokens = collectMeaningfulTokens(candidateSlugs(vaultBasename(resolvedPath)));
  const nameTokens = collectMeaningfulTokens(candidateSlugs(ent.name));
  if (baseTokens.size === 0 || nameTokens.size === 0) return true;
  for (const t of nameTokens) if (baseTokens.has(t)) return true;
  return false;
}

function collectMeaningfulTokens(slugs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const slug of slugs) {
    for (const tok of slug.split('-')) {
      if (tok.length === 0) continue;
      if (SLUG_FUNCTION_WORDS.has(tok)) continue;
      out.add(tok);
    }
  }
  return out;
}
