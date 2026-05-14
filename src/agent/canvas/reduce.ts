import type { Logger } from '@/platform/Logger';
import type {
  ChatMessage,
  OpenAITool,
  ProviderChatRequest,
  ProviderTraceContext,
  StreamEvent,
} from '@/providers/types';
import { CANVAS_BUDGETS } from './budgets';
import { CANVAS_LOG } from './loggingNamespaces';
import {
  EntityGraph,
  Insights,
  type Entity,
  type Edge,
  type EntityFragment,
  type ExtractorOutput,
  type Insights as InsightsT,
  type EntityGraph as EntityGraphT,
  type RelationTypeDef,
} from './schemas';
import { SLUG_FUNCTION_WORDS } from './slugWords';
import {
  CANVAS_PER_TYPE_ALIAS_RESOLVER_SYSTEM,
  CANVAS_REDUCER_ALIAS_RESOLVER_SYSTEM,
} from '@/prompts/agent/canvas/reducePrompts';

const RESOLVE_ALIASES_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'resolve_aliases',
    description:
      'Resolve entity-name overlaps with conflicting types. Map each ambiguous source canonicalId to the canonical id that should be kept (or to itself if it stands alone).',
    parameters: {
      type: 'object',
      properties: {
        aliasMap: {
          type: 'object',
          description: 'Map { sourceCanonicalId: targetCanonicalId }.',
        },
      },
      required: ['aliasMap'],
    },
  },
};

const RESOLVE_PER_TYPE_ALIASES_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'resolve_per_type_aliases',
    description:
      'Each group lists same-type entities with their neighbor canonicalIds and an optional positionalKey (1..N) when the slug encodes an ordinal (numeric/word/Roman). Members sharing the same positionalKey almost always alias each other. Identify which entities are aliases (same concept under different names). Map each redundant canonicalId → target canonicalId that should subsume it. Map to null when the entity stands alone. Never map an id to itself. Be conservative when no positional or source overlap exists.',
    parameters: {
      type: 'object',
      properties: {
        aliasMap: {
          type: 'object',
          description:
            'Map { sourceCanonicalId: targetCanonicalId | null }. Use canonicalIds verbatim from group members.',
        },
      },
      required: ['aliasMap'],
    },
  },
};

export interface CanvasReducerProvider {
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface ReduceEntityGraphDeps {
  readonly provider?: CanvasReducerProvider;
  readonly model?: () => string;
  readonly temperature?: () => number;
  readonly maxTokens?: () => number;
  readonly logger?: Logger;
  /**
   * Slug → vault path index used to resolve raw `definedIn` strings emitted
   * by the extractor (wikilinks, slug fragments) to canonical vault paths.
   * When omitted, definedIn pre-merge falls back to opaque-string equality.
   */
  readonly pageBasenames?: ReadonlyMap<string, string>;
}

export interface ReduceEntityGraphInput {
  readonly outputs: Iterable<ExtractorOutput>;
  readonly signal: AbortSignal;
  readonly traceConfig?: ProviderTraceContext;
  readonly relationTypes?: readonly RelationTypeDef[];
}

export interface ReduceEntityGraphResult {
  readonly graph: EntityGraphT;
  readonly insights: InsightsT;
}

type FragmentRef = {
  readonly canonicalId: string;
  readonly fragment: EntityFragment;
  readonly sourceRef: string;
};

export class ReducerInvalidError extends Error {
  override readonly name = 'ReducerInvalidError';
  readonly code = 'reduce_invalid';
  constructor(message: string) {
    super(`reduce_invalid: ${message}`);
  }
}

function buildFragmentMaps(outputs: readonly ExtractorOutput[]): {
  fragmentsByCanonical: Map<string, FragmentRef[]>;
  tempIdMap: Map<string, string>;
} {
  const fragmentsByCanonical = new Map<string, FragmentRef[]>();
  const tempIdMap = new Map<string, string>();
  for (const out of outputs) {
    for (const ent of out.entities) {
      const canonical = canonicalIdFor(ent);
      const ref: FragmentRef = { canonicalId: canonical, fragment: ent, sourceRef: out.sourceRef };
      const list = fragmentsByCanonical.get(canonical);
      if (list === undefined) fragmentsByCanonical.set(canonical, [ref]);
      else list.push(ref);
      tempIdMap.set(`${out.sourceRef}::${ent.tempId}`, canonical);
    }
  }
  return { fragmentsByCanonical, tempIdMap };
}

function pickDominantFragment(refs: readonly FragmentRef[], canonical: string): EntityFragment {
  const idPrefix = canonical.includes(':') ? canonical.slice(0, canonical.indexOf(':')) : null;
  return (
    refs.find((r) => canonicalIdFor(r.fragment) === canonical)?.fragment ??
    (idPrefix !== null
      ? (refs.find((r) => r.fragment.type === idPrefix)?.fragment ?? refs[0]!.fragment)
      : refs[0]!.fragment)
  );
}

function materializeEntities(
  fragmentsByCanonical: ReadonlyMap<string, FragmentRef[]>,
  pageBasenames: ReadonlyMap<string, string> | undefined,
): Entity[] {
  const entitiesArr: Entity[] = [];
  for (const [canonical, refs] of fragmentsByCanonical) {
    const dominant = pickDominantFragment(refs, canonical);
    const sources = uniqueSorted(refs.map((r) => r.sourceRef)).slice(0, 20);
    const fields = refs.reduce<Record<string, unknown>>((acc, r) => {
      if (r.fragment.fields !== undefined) Object.assign(acc, r.fragment.fields);
      return acc;
    }, {});
    const definedInRaw = pickDefinedIn(
      refs
        .filter((r) => !definedInIsRedundant(r.fragment.definedIn, r.sourceRef))
        .map((r) => r.fragment.definedIn),
    );
    const definedInResolved =
      definedInRaw !== undefined ? normalizeDefinedIn(definedInRaw, pageBasenames) : undefined;
    entitiesArr.push({
      id: canonical,
      type: dominant.type,
      name: dominant.name,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
      sources,
      ...(definedInResolved !== undefined ? { definedIn: definedInResolved } : {}),
    });
  }
  entitiesArr.sort((a, b) => a.id.localeCompare(b.id));
  return entitiesArr;
}

function reorientEdgeEndpoints(
  from: string,
  to: string,
  edgeType: string,
  entityTypeById: ReadonlyMap<string, string>,
  relIndex: ReadonlyMap<string, { readonly from: string; readonly to: string }>,
  knownEntityTypes: ReadonlySet<string>,
): { from: string; to: string } | null {
  const rel = relIndex.get(edgeType);
  if (rel === undefined || rel.from === rel.to) return { from, to };
  const fromType = entityTypeById.get(from);
  const toType = entityTypeById.get(to);
  const matchesForward = fromType === rel.from && toType === rel.to;
  const matchesReverse = fromType === rel.to && toType === rel.from;
  if (!matchesForward && matchesReverse) return { from: to, to: from };
  if (
    !matchesForward &&
    !matchesReverse &&
    fromType !== undefined &&
    toType !== undefined &&
    knownEntityTypes.has(fromType) &&
    knownEntityTypes.has(toType)
  ) {
    return null;
  }
  return { from, to };
}

function materializeEdges(
  outputs: readonly ExtractorOutput[],
  tempIdMap: ReadonlyMap<string, string>,
  entitiesArr: readonly Entity[],
  relationTypes: ReduceEntityGraphInput['relationTypes'],
): Map<string, Edge> {
  const entityTypeById = new Map<string, string>();
  for (const ent of entitiesArr) entityTypeById.set(ent.id, ent.type);
  const relIndex = new Map<string, { readonly from: string; readonly to: string }>();
  const knownEntityTypes = new Set<string>();
  for (const rel of relationTypes ?? []) {
    relIndex.set(rel.name, { from: rel.from, to: rel.to });
    knownEntityTypes.add(rel.from);
    knownEntityTypes.add(rel.to);
  }
  const seenEdges = new Map<string, Edge>();
  for (const out of outputs) {
    for (const ef of out.edges) {
      const edge = buildEdgeFromExtractor(
        out,
        ef,
        tempIdMap,
        entityTypeById,
        relIndex,
        knownEntityTypes,
      );
      if (edge === null || seenEdges.has(edge.id)) continue;
      seenEdges.set(edge.id, edge);
    }
  }
  return seenEdges;
}

function buildEdgeFromExtractor(
  out: ExtractorOutput,
  ef: ExtractorOutput['edges'][number],
  tempIdMap: ReadonlyMap<string, string>,
  entityTypeById: ReadonlyMap<string, string>,
  relIndex: ReadonlyMap<string, { readonly from: string; readonly to: string }>,
  knownEntityTypes: ReadonlySet<string>,
): Edge | null {
  const rawFrom = tempIdMap.get(`${out.sourceRef}::${ef.fromTempId}`);
  const rawTo = tempIdMap.get(`${out.sourceRef}::${ef.toTempId}`);
  if (rawFrom === undefined || rawTo === undefined) return null;
  const oriented = reorientEdgeEndpoints(
    rawFrom,
    rawTo,
    ef.type,
    entityTypeById,
    relIndex,
    knownEntityTypes,
  );
  if (oriented === null) return null;
  const { from, to } = oriented;
  if (from === to) return null;
  const id = `${from}|${to}|${ef.type}`;
  return {
    id,
    from,
    to,
    type: ef.type,
    ...(ef.label !== undefined ? { label: ef.label } : {}),
  };
}

export async function reduceEntityGraph(
  input: ReduceEntityGraphInput,
  deps: ReduceEntityGraphDeps,
): Promise<ReduceEntityGraphResult> {
  const outputs = Array.from(input.outputs);
  if (outputs.length === 0) {
    return {
      graph: { schemaVersion: 1, entities: [], edges: [] },
      insights: { hubs: [], components: { count: 0, sizes: [] }, orphans: [], perTypeCount: {} },
    };
  }

  const { fragmentsByCanonical, tempIdMap } = buildFragmentMaps(outputs);

  // Pre-merge passes (deterministic, run BEFORE LLM alias resolvers).
  applyCanonicalAliasMap(
    buildDefinedInAliasMap(fragmentsByCanonical, deps.pageBasenames),
    fragmentsByCanonical,
    tempIdMap,
  );
  applyCanonicalAliasMap(
    buildPositionAliasMap(fragmentsByCanonical),
    fragmentsByCanonical,
    tempIdMap,
  );
  applyCanonicalAliasMap(
    buildTokenSubsetAliasMap(fragmentsByCanonical),
    fragmentsByCanonical,
    tempIdMap,
  );

  // Detect ambiguous overlaps: same normalized-name across different types.
  const aliasMap = await maybeResolveAliases(fragmentsByCanonical, input, deps);
  applyCanonicalAliasMap(aliasMap, fragmentsByCanonical, tempIdMap);

  const entitiesArr = materializeEntities(fragmentsByCanonical, deps.pageBasenames);
  const seenEdges = materializeEdges(outputs, tempIdMap, entitiesArr, input.relationTypes);

  let aliased: PerTypeResolveResult = { entities: entitiesArr, edges: seenEdges };
  for (let pass = 0; pass < 2; pass += 1) {
    const next = await maybeResolvePerTypeAliases(aliased.entities, aliased.edges, input, deps);
    const merged = next.entities.length < aliased.entities.length;
    aliased = next;
    if (!merged) break;
  }
  const filteredEntities = dropOrphanTwins(aliased.entities, aliased.edges);
  const graphCandidate = {
    schemaVersion: 1,
    entities: filteredEntities,
    edges: Array.from(aliased.edges.values()),
  };
  const graphValidation = EntityGraph.safeParse(graphCandidate);
  if (!graphValidation.success) {
    deps.logger?.warn(CANVAS_LOG.create.reduce.failed, {
      code: 'reduce_invalid',
      issues: graphValidation.error.issues.map((i) => i.message).join('; '),
    });
    throw new ReducerInvalidError('graph schema validation failed');
  }

  const insightsCandidate = computeInsights(graphValidation.data);
  const insightsValidation = Insights.safeParse(insightsCandidate);
  if (!insightsValidation.success) {
    throw new ReducerInvalidError('insights schema validation failed');
  }

  return { graph: graphValidation.data, insights: insightsValidation.data };
}

function canonicalIdFor(ent: EntityFragment): string {
  const name = ent.name;
  if (looksLikeUrl(name)) return `url:${name.toLowerCase()}`;
  if (looksLikeWikilink(name)) {
    const stripped = name.replace(/^\[\[|\]\]$/g, '');
    return `wikilink:${stripped.replace(/\.md$/i, '')}`;
  }
  return `${ent.type}:${normalizeNameSlug(slugify(name), slugify(ent.type))}`;
}

function normalizeNameSlug(slug: string, typeSlug: string): string {
  let s = slug;
  s = stripIfMinTokens(s, /^thou-shalt-(not-)?/, 2);
  s = stripIfMinTokens(s, /^(the|a|an)-/, 2);
  if (typeSlug.length > 0) {
    s = stripTypeSlug(s, new RegExp(`^${typeSlug}-`));
    s = stripTypeSlug(s, new RegExp(`-${typeSlug}$`));
  }
  return s;
}

function stripIfMinTokens(s: string, re: RegExp, minTokens: number): string {
  const after = s.replace(re, '');
  if (after.length === 0) return s;
  const tokens = after.split('-').filter(Boolean).length;
  if (tokens < minTokens) return s;
  return after;
}

function stripTypeSlug(s: string, re: RegExp): string {
  const after = s.replace(re, '');
  if (after === s || after.length === 0) return s;
  const tokens = after.split('-').filter(Boolean);
  if (tokens.length === 0) return s;
  if (SLUG_FUNCTION_WORDS.has(tokens[0]!)) return s;
  if (SLUG_FUNCTION_WORDS.has(tokens[tokens.length - 1]!)) return s;
  return after;
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function looksLikeWikilink(s: string): boolean {
  return /^\[\[.+\]\]$/.test(s) || s.endsWith('.md');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-') // NOSONAR(typescript:S5852): single char class + quantifier, linear.
    .replace(/^-+|-+$/g, ''); // NOSONAR(typescript:S5852): anchored alternation over single-char class, linear.
}

function uniqueSorted(arr: readonly string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

function isOrphanTwin(orph: Entity, other: Entity, degree: ReadonlyMap<string, number>): boolean {
  if (other.id === orph.id) return false;
  if (other.type !== orph.type) return false;
  if ((degree.get(other.id) ?? 0) === 0) return false;
  const orphSlug = stripIdPrefix(orph.id);
  const otherSlug = stripIdPrefix(other.id);
  const orphPos = extractPositionalKey(orphSlug);
  return (
    isSlugTokenSuffix(otherSlug, orphSlug) ||
    isSlugTokenSuffix(orphSlug, otherSlug) ||
    sharesPositionalKey(orphPos, otherSlug) ||
    slugJaccard(orphSlug, otherSlug) >= 0.5
  );
}

function shouldDropOrphan(
  orph: Entity,
  entities: readonly Entity[],
  degree: ReadonlyMap<string, number>,
  typeCount: ReadonlyMap<string, number>,
  dropPerType: ReadonlyMap<string, number>,
): boolean {
  for (const other of entities) {
    if (!isOrphanTwin(orph, other, degree)) continue;
    const typeTotal = typeCount.get(orph.type) ?? 0;
    const alreadyDropped = dropPerType.get(orph.type) ?? 0;
    if (typeTotal > 0 && (alreadyDropped + 1) * 2 > typeTotal) continue;
    return true;
  }
  return false;
}

function dropOrphanTwins(entities: readonly Entity[], edges: ReadonlyMap<string, Edge>): Entity[] {
  if (entities.length === 0) return [...entities];
  const degree = new Map<string, number>();
  for (const e of entities) degree.set(e.id, 0);
  for (const ed of edges.values()) {
    degree.set(ed.from, (degree.get(ed.from) ?? 0) + 1);
    degree.set(ed.to, (degree.get(ed.to) ?? 0) + 1);
  }
  const typeCount = new Map<string, number>();
  for (const e of entities) typeCount.set(e.type, (typeCount.get(e.type) ?? 0) + 1);
  const dropPerType = new Map<string, number>();
  const drop = new Set<string>();
  for (const orph of entities) {
    if ((degree.get(orph.id) ?? 0) !== 0) continue;
    if (!shouldDropOrphan(orph, entities, degree, typeCount, dropPerType)) continue;
    drop.add(orph.id);
    dropPerType.set(orph.type, (dropPerType.get(orph.type) ?? 0) + 1);
  }
  if (drop.size === 0) return [...entities];
  return entities.filter((e) => !drop.has(e.id));
}

function sharesPositionalKey(orphKey: string | null, otherSlug: string): boolean {
  if (orphKey === null) return false;
  const otherKey = extractPositionalKey(otherSlug);
  return otherKey !== null && otherKey === orphKey;
}

function slugJaccard(a: string, b: string): number {
  const at = new Set(a.split('-').filter((t) => t.length > 0 && !SLUG_FUNCTION_WORDS.has(t)));
  const bt = new Set(b.split('-').filter((t) => t.length > 0 && !SLUG_FUNCTION_WORDS.has(t)));
  if (at.size === 0 || bt.size === 0) return 0;
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter += 1;
  const union = at.size + bt.size - inter;
  return union === 0 ? 0 : inter / union;
}

function stripIdPrefix(id: string): string {
  const idx = id.indexOf(':');
  return idx >= 0 ? id.slice(idx + 1) : id;
}

function stripTypePrefix(id: string): string {
  const idx = id.indexOf(':');
  return idx >= 0 ? id.slice(0, idx) : '';
}

function applyCanonicalAliasMap(
  aliasMap: ReadonlyMap<string, string>,
  fragmentsByCanonical: Map<string, FragmentRef[]>,
  tempIdMap: Map<string, string>,
): void {
  if (aliasMap.size === 0) return;
  const finalMap = collapseAliasChain(aliasMap);
  if (finalMap.size === 0) return;
  remapFragments(fragmentsByCanonical, finalMap);
  for (const [tempKey, canonical] of tempIdMap) {
    const target = finalMap.get(canonical);
    if (target !== undefined) tempIdMap.set(tempKey, target);
  }
}

function collapseAliasChain(aliasMap: ReadonlyMap<string, string>): Map<string, string> {
  const finalMap = new Map<string, string>();
  for (const src of aliasMap.keys()) {
    let cur = aliasMap.get(src)!;
    const seen = new Set<string>([src, cur]);
    for (let i = 0; i < 8; i += 1) {
      const next = aliasMap.get(cur);
      if (next === undefined || seen.has(next)) break;
      cur = next;
      seen.add(cur);
    }
    if (cur !== src) finalMap.set(src, cur);
  }
  return finalMap;
}

function remapFragments(
  fragmentsByCanonical: Map<string, FragmentRef[]>,
  finalMap: ReadonlyMap<string, string>,
): void {
  const merged = new Map<string, FragmentRef[]>();
  for (const [canonical, refs] of fragmentsByCanonical) {
    const target = finalMap.get(canonical) ?? canonical;
    const list = merged.get(target);
    if (list === undefined) merged.set(target, [...refs]);
    else list.push(...refs);
  }
  fragmentsByCanonical.clear();
  for (const [k, v] of merged) fragmentsByCanonical.set(k, v);
}

function pickDefinedIn(values: readonly (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (v !== undefined && v.length > 0) return v;
  }
  return undefined;
}

function basenameSlug(s: string): string {
  const noProto = s.replace(/^[a-z]+:/i, '');
  const last = noProto.lastIndexOf('/');
  const tail = last >= 0 ? noProto.slice(last + 1) : noProto;
  return slugify(tail.replace(/\.md$/i, ''));
}

/**
 * True when an extractor-emitted `definedIn` is just an echo of the source
 * the entity was extracted from (same basename slug). Such values carry no
 * dedup signal — every entity in that source would share them — and would
 * cause unrelated entities to collapse onto the source's wiki page. Skip
 * them in pre-merge A and during entity materialization.
 */
export function definedInIsRedundant(rawDefinedIn: string | undefined, sourceRef: string): boolean {
  if (rawDefinedIn === undefined || rawDefinedIn.length === 0) return true;
  const di = rawDefinedIn.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  if (di.length === 0) return true;
  if (/^https?:\/\//i.test(di)) return false; // URLs never redundant
  const defSlug = basenameSlug(di);
  const srcSlug = basenameSlug(sourceRef);
  if (defSlug.length === 0 || srcSlug.length === 0) return false;
  return defSlug === srcSlug;
}

/**
 * Normalize a raw `definedIn` value into a stable dedup key. Strips wikilink
 * brackets and `.md` suffix, lowercases URLs, resolves bare slugs against
 * `pageBasenames` when available. Falls back to the cleaned string so two
 * entities with identical raw values still collide even without resolution.
 */
export function normalizeDefinedIn(
  raw: string,
  pageBasenames?: ReadonlyMap<string, string>,
): string {
  const stripped = raw.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  if (stripped.length === 0) return raw.trim().toLowerCase();
  if (/^https?:\/\//i.test(stripped)) return stripped.toLowerCase();
  if (stripped.includes('/')) return normalizePathStyle(stripped, pageBasenames);
  return normalizeSlugStyle(stripped, pageBasenames);
}

function normalizePathStyle(
  stripped: string,
  pageBasenames: ReadonlyMap<string, string> | undefined,
): string {
  if (pageBasenames !== undefined) {
    const last = stripped.lastIndexOf('/');
    const basename = stripped.slice(last + 1).replace(/\.md$/i, '');
    const slug = slugify(basename);
    if (slug.length > 0) {
      const path = pageBasenames.get(slug);
      if (path !== undefined) return path;
    }
  }
  return /\.md$/i.test(stripped) ? stripped : `${stripped}.md`;
}

function normalizeSlugStyle(
  stripped: string,
  pageBasenames: ReadonlyMap<string, string> | undefined,
): string {
  const slug = slugify(stripped.replace(/\.md$/i, ''));
  if (slug.length === 0) return stripped.toLowerCase();
  if (pageBasenames !== undefined) {
    const path = pageBasenames.get(slug);
    if (path !== undefined) return path;
  }
  return slug;
}

export function buildDefinedInAliasMap(
  fragmentsByCanonical: ReadonlyMap<
    string,
    readonly { fragment: EntityFragment; sourceRef?: string }[]
  >,
  pageBasenames?: ReadonlyMap<string, string>,
): Map<string, string> {
  const keyByCanonical = new Map<string, string>();
  for (const [canonical, refs] of fragmentsByCanonical) {
    const di = pickDefinedIn(
      refs
        .filter((r) => !definedInIsRedundant(r.fragment.definedIn, r.sourceRef ?? ''))
        .map((r) => r.fragment.definedIn),
    );
    if (di === undefined) continue;
    const norm = normalizeDefinedIn(di, pageBasenames);
    if (norm.length === 0) continue;
    const type = stripTypePrefix(canonical);
    keyByCanonical.set(canonical, `${type}::${norm}`);
  }
  return groupAliasMap(keyByCanonical);
}

function pickPosition(values: readonly (Record<string, unknown> | undefined)[]): number | null {
  for (const fields of values) {
    if (fields === undefined) continue;
    const raw = fields.position;
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseInt(raw, 10)
          : Number.NaN;
    if (Number.isFinite(n) && n >= 1 && n <= 99) return Math.trunc(n);
  }
  return null;
}

export function buildPositionAliasMap(
  fragmentsByCanonical: ReadonlyMap<string, readonly { fragment: EntityFragment }[]>,
): Map<string, string> {
  const keyByCanonical = new Map<string, string>();
  for (const [canonical, refs] of fragmentsByCanonical) {
    const pos = pickPosition(refs.map((r) => r.fragment.fields));
    if (pos === null) continue;
    const type = stripTypePrefix(canonical);
    if (type.length === 0) continue;
    keyByCanonical.set(canonical, `${type}::pos${pos}`);
  }
  return groupAliasMap(keyByCanonical);
}

function groupCanonicalsByType(
  fragmentsByCanonical: ReadonlyMap<string, readonly unknown[]>,
): Map<string, string[]> {
  const byType = new Map<string, string[]>();
  for (const canonical of fragmentsByCanonical.keys()) {
    const type = stripTypePrefix(canonical);
    if (type.length === 0) continue;
    // Skip URL/wikilink namespaces — they own their own equality.
    if (type === 'url' || type === 'wikilink') continue;
    const list = byType.get(type);
    if (list === undefined) byType.set(type, [canonical]);
    else list.push(canonical);
  }
  return byType;
}

function tokenizeIds(ids: readonly string[]): Map<string, Set<string>> {
  const tokens = new Map<string, Set<string>>();
  for (const id of ids) {
    const set = new Set(
      stripIdPrefix(id)
        .split('-')
        .filter((t) => t.length > 0 && !SLUG_FUNCTION_WORDS.has(t)),
    );
    tokens.set(id, set);
  }
  return tokens;
}

function tokenSubsetAliasPair(
  a: string,
  b: string,
  ta: ReadonlySet<string>,
  tb: ReadonlySet<string>,
): { from: string; to: string } | null {
  if (ta.size === tb.size) return null;
  const aIsSmaller = ta.size < tb.size;
  const smaller = aIsSmaller ? a : b;
  const larger = aIsSmaller ? b : a;
  const smallerSet = aIsSmaller ? ta : tb;
  const largerSet = aIsSmaller ? tb : ta;
  if (smallerSet.size < 2) return null;
  for (const t of smallerSet) if (!largerSet.has(t)) return null;
  if (smallerSet.size / largerSet.size < 0.5) return null;
  // Larger merges into smaller — shorter form is usually the canonical wiki-page
  // title; verbose phrasings or qualifier prefixes should not absorb the canonical.
  return { from: larger, to: smaller };
}

export function buildTokenSubsetAliasMap(
  fragmentsByCanonical: ReadonlyMap<string, readonly unknown[]>,
): Map<string, string> {
  const byType = groupCanonicalsByType(fragmentsByCanonical);
  const aliasMap = new Map<string, string>();
  for (const [, ids] of byType) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    const tokens = tokenizeIds(sorted);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!;
        const b = sorted[j]!;
        const pair = tokenSubsetAliasPair(a, b, tokens.get(a)!, tokens.get(b)!);
        if (pair !== null) aliasMap.set(pair.from, pair.to);
      }
    }
  }
  return aliasMap;
}

function groupAliasMap(keyByCanonical: ReadonlyMap<string, string>): Map<string, string> {
  const byKey = new Map<string, string[]>();
  for (const [canonical, key] of keyByCanonical) {
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [canonical]);
    else list.push(canonical);
  }
  const aliasMap = new Map<string, string>();
  for (const [, ids] of byKey) {
    if (ids.length < 2) continue;
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    const target = sorted[0]!;
    for (const src of sorted.slice(1)) aliasMap.set(src, target);
  }
  return aliasMap;
}

const ORDINAL_WORDS: Readonly<Record<string, string>> = {
  first: '1',
  second: '2',
  third: '3',
  fourth: '4',
  fifth: '5',
  sixth: '6',
  seventh: '7',
  eighth: '8',
  ninth: '9',
  tenth: '10',
};

const ROMAN_NUMERALS: Readonly<Record<string, string>> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

/**
 * Extract an ordinal positional key (1..10) from a slug if it encodes one.
 * Recognises numeric tokens, English ordinal words, and lowercase Roman numerals.
 * Returns null when no positional token is present.
 */
export function extractPositionalKey(slug: string): string | null {
  const tokens = slug.split('-').filter(Boolean);
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      const n = Number.parseInt(tok, 10);
      if (n >= 1 && n <= 10) return String(n);
    }
    const word = ORDINAL_WORDS[tok];
    if (word !== undefined) return word;
    const roman = ROMAN_NUMERALS[tok];
    if (roman !== undefined) return roman;
  }
  return null;
}

function isSlugTokenSuffix(big: string, small: string): boolean {
  const bigTokens = big.split('-').filter(Boolean);
  const smallTokens = small.split('-').filter(Boolean);
  if (smallTokens.length < 2) return false;
  if (smallTokens.length >= bigTokens.length) return false;
  const offset = bigTokens.length - smallTokens.length;
  for (let i = 0; i < smallTokens.length; i += 1) {
    if (bigTokens[offset + i] !== smallTokens[i]) return false;
  }
  return true;
}

interface OverlapGroup {
  readonly normalizedName: string;
  readonly canonicalIds: readonly string[];
}

function detectAmbiguousOverlaps(
  fragmentsByCanonical: ReadonlyMap<string, readonly { fragment: EntityFragment }[]>,
): readonly OverlapGroup[] {
  const byNormalizedName = new Map<string, Set<string>>();
  for (const [canonical, refs] of fragmentsByCanonical) {
    const nameKey = slugify(refs[0]!.fragment.name);
    if (nameKey.length === 0) continue;
    const set = byNormalizedName.get(nameKey);
    if (set === undefined) byNormalizedName.set(nameKey, new Set([canonical]));
    else set.add(canonical);
  }
  const groups: OverlapGroup[] = [];
  for (const [nameKey, ids] of byNormalizedName) {
    if (ids.size > 1) {
      groups.push({
        normalizedName: nameKey,
        canonicalIds: Array.from(ids).sort((a, b) => a.localeCompare(b)),
      });
    }
  }
  return groups;
}

async function maybeResolveAliases(
  fragmentsByCanonical: ReadonlyMap<string, FragmentRefArr>,
  input: ReduceEntityGraphInput,
  deps: ReduceEntityGraphDeps,
): Promise<Map<string, string>> {
  const overlaps = detectAmbiguousOverlaps(fragmentsByCanonical);
  if (overlaps.length === 0) return new Map();
  if (deps.provider === undefined || deps.model === undefined) return new Map();
  if (input.signal.aborted) return new Map();

  const req = buildAliasResolveRequest(overlaps, input, deps);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const collected = await collectStream(deps.provider.stream(req, input.signal), input.signal);
    const result = extractAliasMapFromCall(collected.toolCalls, 'resolve_aliases');
    if (result === 'no-call') {
      if (attempt === 1) throw new ReducerInvalidError('alias-resolver returned no tool call');
      continue;
    }
    if (result === 'invalid') {
      if (attempt === 1) throw new ReducerInvalidError('aliasMap missing or invalid');
      continue;
    }
    return result;
  }
  return new Map();
}

function buildAliasResolveRequest(
  overlaps: readonly OverlapGroup[],
  input: ReduceEntityGraphInput,
  deps: ReduceEntityGraphDeps,
): ProviderChatRequest {
  const messages: ChatMessage[] = [
    { role: 'system', content: CANVAS_REDUCER_ALIAS_RESOLVER_SYSTEM },
    { role: 'user', content: JSON.stringify({ overlaps }) },
  ];
  return {
    model: deps.model!(),
    messages,
    ...(deps.temperature !== undefined ? { temperature: deps.temperature() } : {}),
    maxTokens: deps.maxTokens !== undefined ? deps.maxTokens() : CANVAS_BUDGETS.reducerOutputCap,
    tools: [RESOLVE_ALIASES_TOOL],
    ...(input.traceConfig !== undefined ? { trace: input.traceConfig } : {}),
  };
}

function extractAliasMapFromCall(
  toolCalls: readonly { name: string; argsJson: string }[],
  toolName: string,
): Map<string, string> | 'no-call' | 'invalid' {
  const call = toolCalls.find((c) => c.name === toolName);
  if (call === undefined) return 'no-call';
  const parsed = tryParseJson(call.argsJson);
  const aliasMap = (parsed as { aliasMap?: unknown } | null)?.aliasMap;
  if (aliasMap === null || typeof aliasMap !== 'object') return 'invalid';
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(aliasMap as Record<string, unknown>)) {
    if (typeof v === 'string') out.set(k, v);
  }
  return out;
}

type FragmentRefArr = readonly { fragment: EntityFragment; sourceRef: string }[];

interface PerTypeResolveResult {
  readonly entities: Entity[];
  readonly edges: Map<string, Edge>;
}

type PerTypeAliasGroup = {
  readonly type: string;
  readonly members: readonly {
    id: string;
    name: string;
    sources: readonly string[];
    neighbors: readonly string[];
    positionalKey?: string;
  }[];
};

function buildPerTypeAliasGroups(
  entities: readonly Entity[],
  edges: ReadonlyMap<string, Edge>,
): PerTypeAliasGroup[] {
  const byType = new Map<string, Entity[]>();
  for (const e of entities) {
    const list = byType.get(e.type);
    if (list === undefined) byType.set(e.type, [e]);
    else list.push(e);
  }
  const neighbors = new Map<string, Set<string>>();
  for (const e of entities) neighbors.set(e.id, new Set());
  for (const ed of edges.values()) {
    neighbors.get(ed.from)?.add(ed.to);
    neighbors.get(ed.to)?.add(ed.from);
  }
  const groups: PerTypeAliasGroup[] = [];
  for (const [type, list] of byType) {
    if (list.length < 2) continue;
    groups.push({
      type,
      members: list.map((e) => {
        const positionalKey = extractPositionalKey(stripIdPrefix(e.id));
        return {
          id: e.id,
          name: e.name,
          sources: e.sources.slice(0, 3),
          neighbors: [...(neighbors.get(e.id) ?? [])].sort((a, b) => a.localeCompare(b)),
          ...(positionalKey !== null ? { positionalKey } : {}),
        };
      }),
    });
  }
  return groups;
}

function resolveTransitiveRedirects(
  directRedirect: ReadonlyMap<string, string>,
): Map<string, string> {
  const finalRedirect = new Map<string, string>();
  for (const src of directRedirect.keys()) {
    let cur = src;
    const seen = new Set<string>([cur]);
    for (let i = 0; i < 8; i += 1) {
      const next = directRedirect.get(cur);
      if (next === undefined || next === cur || seen.has(next)) break;
      cur = next;
      seen.add(cur);
    }
    if (cur !== src) finalRedirect.set(src, cur);
  }
  return finalRedirect;
}

function buildDirectRedirect(
  aliasMap: Record<string, unknown>,
  entities: readonly Entity[],
): Map<string, string> {
  const validIds = new Set(entities.map((e) => e.id));
  const entityType = new Map<string, string>();
  for (const e of entities) entityType.set(e.id, e.type);
  const directRedirect = new Map<string, string>();
  for (const [srcId, target] of Object.entries(aliasMap)) {
    if (typeof target !== 'string') continue;
    if (target === srcId) continue;
    if (!validIds.has(srcId) || !validIds.has(target)) continue;
    if (entityType.get(srcId) !== entityType.get(target)) continue;
    directRedirect.set(srcId, target);
  }
  return directRedirect;
}

async function maybeResolvePerTypeAliases(
  entities: readonly Entity[],
  edges: ReadonlyMap<string, Edge>,
  input: ReduceEntityGraphInput,
  deps: ReduceEntityGraphDeps,
): Promise<PerTypeResolveResult> {
  const passthrough: PerTypeResolveResult = { entities: [...entities], edges: new Map(edges) };
  if (deps.provider === undefined || deps.model === undefined) return passthrough;
  if (input.signal.aborted) return passthrough;
  if (entities.length === 0) return passthrough;

  const groups = buildPerTypeAliasGroups(entities, edges);
  if (groups.length === 0) return passthrough;

  const aliasMap = await fetchPerTypeAliasMap(groups, input, deps);
  if (aliasMap === null) return passthrough;

  const directRedirect = buildDirectRedirect(aliasMap, entities);
  if (directRedirect.size === 0) return passthrough;

  const finalRedirect = resolveTransitiveRedirects(directRedirect);
  if (finalRedirect.size === 0) return passthrough;

  const newEntities = mergeRedirectedEntities(entities, finalRedirect);
  const newEdges = remapEdges(edges, finalRedirect);
  return { entities: newEntities, edges: newEdges };
}

async function fetchPerTypeAliasMap(
  groups: readonly PerTypeAliasGroup[],
  input: ReduceEntityGraphInput,
  deps: ReduceEntityGraphDeps,
): Promise<Record<string, unknown> | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: CANVAS_PER_TYPE_ALIAS_RESOLVER_SYSTEM },
    { role: 'user', content: JSON.stringify({ groups }) },
  ];
  const req: ProviderChatRequest = {
    model: deps.model!(),
    messages,
    ...(deps.temperature !== undefined ? { temperature: deps.temperature() } : {}),
    maxTokens: deps.maxTokens !== undefined ? deps.maxTokens() : CANVAS_BUDGETS.reducerOutputCap,
    tools: [RESOLVE_PER_TYPE_ALIASES_TOOL],
    ...(input.traceConfig !== undefined ? { trace: input.traceConfig } : {}),
  };
  try {
    const collected = await collectStream(deps.provider!.stream(req, input.signal), input.signal);
    const call = collected.toolCalls.find((c) => c.name === 'resolve_per_type_aliases');
    if (call === undefined) return null;
    const parsed = tryParseJson(call.argsJson) as { aliasMap?: unknown } | null;
    if (parsed === null || parsed.aliasMap === null || typeof parsed.aliasMap !== 'object') {
      return null;
    }
    return parsed.aliasMap as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeRedirectedEntities(
  entities: readonly Entity[],
  finalRedirect: ReadonlyMap<string, string>,
): Entity[] {
  const sourceMerge = new Map<string, Set<string>>();
  for (const e of entities) {
    if (!finalRedirect.has(e.id)) continue;
    const target = finalRedirect.get(e.id)!;
    const set = sourceMerge.get(target) ?? new Set<string>();
    for (const s of e.sources) set.add(s);
    sourceMerge.set(target, set);
  }
  return entities
    .filter((e) => !finalRedirect.has(e.id))
    .map((e) => {
      const extra = sourceMerge.get(e.id);
      if (extra === undefined) return e;
      const merged = new Set<string>(e.sources);
      for (const s of extra) merged.add(s);
      const sorted = [...merged].sort((a, b) => a.localeCompare(b)).slice(0, 20);
      return { ...e, sources: sorted };
    });
}

function remapEdges(
  edges: ReadonlyMap<string, Edge>,
  finalRedirect: ReadonlyMap<string, string>,
): Map<string, Edge> {
  const newEdges = new Map<string, Edge>();
  for (const ed of edges.values()) {
    const newFrom = finalRedirect.get(ed.from) ?? ed.from;
    const newTo = finalRedirect.get(ed.to) ?? ed.to;
    if (newFrom === newTo) continue;
    const id = `${newFrom}|${newTo}|${ed.type}`;
    if (newEdges.has(id)) continue;
    newEdges.set(id, { ...ed, id, from: newFrom, to: newTo });
  }
  return newEdges;
}

function computeInsights(graph: EntityGraphT): InsightsT {
  const { degree, adjacency } = buildDegreeAndAdjacency(graph);
  const hubs = graph.entities
    .map((e) => ({ id: e.id, name: e.name, degree: degree.get(e.id) ?? 0 }))
    .filter((h) => h.degree > 0)
    .sort((a, b) => {
      if (b.degree !== a.degree) return b.degree - a.degree;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 5);

  const seen = new Set<string>();
  const componentSizes: number[] = [];
  for (const e of graph.entities) {
    if (seen.has(e.id)) continue;
    const size = bfsComponentSize(e.id, adjacency, seen);
    if (size > 0) componentSizes.push(size);
  }
  componentSizes.sort((a, b) => b - a);

  const orphans = graph.entities
    .filter((e) => (degree.get(e.id) ?? 0) === 0)
    .map((e) => e.id)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 50);

  const perTypeCount: Record<string, number> = {};
  for (const e of graph.entities) {
    perTypeCount[e.type] = (perTypeCount[e.type] ?? 0) + 1;
  }

  return {
    hubs,
    components: { count: componentSizes.length, sizes: componentSizes },
    orphans,
    perTypeCount,
  };
}

function buildDegreeAndAdjacency(graph: EntityGraphT): {
  degree: Map<string, number>;
  adjacency: Map<string, Set<string>>;
} {
  const degree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();
  for (const e of graph.entities) {
    degree.set(e.id, 0);
    adjacency.set(e.id, new Set());
  }
  for (const edge of graph.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  return { degree, adjacency };
}

function bfsComponentSize(
  start: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  seen: Set<string>,
): number {
  const queue = [start];
  let size = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    size += 1;
    for (const n of adjacency.get(cur) ?? []) {
      if (!seen.has(n)) queue.push(n);
    }
  }
  return size;
}

type ReducerToolBufMap = Map<number, { id: string; name: string; args: string }>;

function applyReducerDelta(
  ev: Extract<ReducerStreamEvent, { type: 'block_delta' }>,
  toolBufs: ReducerToolBufMap,
  textBuffer: string,
): string {
  if (ev.delta?.type === 'input_json_delta') {
    const buf = toolBufs.get(ev.index);
    if (buf !== undefined) buf.args += (ev.delta as { partial_json: string }).partial_json;
    return textBuffer;
  }
  if (ev.delta?.type === 'text_delta') {
    return textBuffer + (ev.delta as { text: string }).text;
  }
  return textBuffer;
}

function flushReducerToolBuf(
  ev: Extract<ReducerStreamEvent, { type: 'block_stop' }>,
  toolBufs: ReducerToolBufMap,
  toolCalls: Array<{ name: string; argsJson: string }>,
): void {
  const buf = toolBufs.get(ev.index);
  if (buf !== undefined) {
    toolCalls.push({ name: buf.name, argsJson: buf.args.length === 0 ? '{}' : buf.args });
    toolBufs.delete(ev.index);
  }
}

async function collectStream(
  stream: AsyncIterable<StreamEvent>,
  signal: AbortSignal,
): Promise<{ textBuffer: string; toolCalls: ReadonlyArray<{ name: string; argsJson: string }> }> {
  let textBuffer = '';
  const toolCalls: Array<{ name: string; argsJson: string }> = [];
  const toolBufs: ReducerToolBufMap = new Map();
  for await (const ev of stream as AsyncIterable<ReducerStreamEvent>) {
    if (signal.aborted) break;
    if (ev.type === 'token') textBuffer += ev.text ?? '';
    else if (ev.type === 'tool_call')
      toolCalls.push({ name: ev.call.name, argsJson: ev.call.argsJson });
    else if (ev.type === 'block_start' && ev.block?.type === 'tool_use') {
      const block = ev.block as { id: string; name: string };
      toolBufs.set(ev.index, { id: block.id, name: block.name, args: '' });
    } else if (ev.type === 'block_delta') textBuffer = applyReducerDelta(ev, toolBufs, textBuffer);
    else if (ev.type === 'block_stop') flushReducerToolBuf(ev, toolBufs, toolCalls);
    else if (ev.type === 'done' || ev.type === 'error') break;
  }
  return { textBuffer, toolCalls };
}

function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

type ReducerStreamEvent =
  | { readonly type: 'token'; readonly text?: string }
  | { readonly type: 'tool_call'; readonly call: { name: string; argsJson: string } }
  | {
      readonly type: 'block_start';
      readonly index: number;
      readonly block: { type: string; id?: string; name?: string };
    }
  | {
      readonly type: 'block_delta';
      readonly index: number;
      readonly delta: { type: string; text?: string; partial_json?: string };
    }
  | { readonly type: 'block_stop'; readonly index: number }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly error?: Error };
