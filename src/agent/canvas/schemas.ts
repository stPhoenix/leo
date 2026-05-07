import { z } from 'zod';

export const EntityTypeDef = z.object({
  name: z.string().min(1),
  description: z.string(),
  fields: z.array(z.string()).max(8).optional(),
});
export type EntityTypeDef = z.infer<typeof EntityTypeDef>;

export const RelationTypeDef = z.object({
  name: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  description: z.string(),
});
export type RelationTypeDef = z.infer<typeof RelationTypeDef>;

export const Entity = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  sources: z.array(z.string()).max(20),
  filePath: z.string().min(1).optional(),
  /**
   * Canonical defining link for the entity (resolved vault path, URL, or
   * opaque token from extractor). Reducer treats `(type, definedIn)`
   * collisions as a primary dedup key — entities pointing to the same
   * definitional resource collapse regardless of name divergence.
   */
  definedIn: z.string().min(1).optional(),
});
export type Entity = z.infer<typeof Entity>;

export const Edge = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
});
export type Edge = z.infer<typeof Edge>;

export const EntityGraph = z.object({
  schemaVersion: z.literal(1),
  entities: z.array(Entity).max(500),
  edges: z.array(Edge).max(2000),
});
export type EntityGraph = z.infer<typeof EntityGraph>;

export const Insights = z.object({
  hubs: z.array(z.object({ id: z.string(), name: z.string(), degree: z.number() })).max(5),
  components: z.object({
    count: z.number(),
    sizes: z.array(z.number()),
  }),
  orphans: z.array(z.string()).max(50),
  perTypeCount: z.record(z.string(), z.number()),
});
export type Insights = z.infer<typeof Insights>;

export const SourceHint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('vaultGlob'), glob: z.string() }),
  z.object({ kind: z.literal('vaultTag'), tag: z.string() }),
  z.object({
    kind: z.literal('vaultFrontmatter'),
    field: z.string(),
    value: z.string(),
  }),
  z.object({ kind: z.literal('mention'), path: z.string() }),
  z.object({ kind: z.literal('url'), url: z.string() }),
  z.object({ kind: z.literal('attachment'), attachmentId: z.string() }),
  z.object({
    kind: z.literal('conversation'),
    title: z.string(),
    body: z.string(),
  }),
]);
export type SourceHint = z.infer<typeof SourceHint>;

export const PRESET_IDS = ['bipartite', 'tree', 'radial', 'force', 'grid', 'timeline'] as const;

export const PresetIdSchema = z.enum(PRESET_IDS);
export type PresetId = z.infer<typeof PresetIdSchema>;

export const LayoutHintSchema = z.enum([...PRESET_IDS, 'auto']);
export type LayoutHint = z.infer<typeof LayoutHintSchema>;

export const RunPlan = z.object({
  schemaVersion: z.literal(1),
  entityTypes: z.array(EntityTypeDef).max(8),
  relationTypes: z.array(RelationTypeDef).max(16),
  sourceHints: z.array(SourceHint).max(32),
  layoutHint: LayoutHintSchema,
  scope: z
    .object({
      dateRange: z.tuple([z.string(), z.string()]).optional(),
      filter: z.string().optional(),
    })
    .optional(),
  outputPath: z.string().min(1),
});
export type RunPlan = z.infer<typeof RunPlan>;

export const Coord = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
});
export type Coord = z.infer<typeof Coord>;

export const EdgeTombstone = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
});
export type EdgeTombstone = z.infer<typeof EdgeTombstone>;

export const EntityFragment = z.object({
  tempId: z.string().min(1),
  type: z.string().min(1),
  name: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  /**
   * Optional defining-resource link emitted by the extractor — wikilink,
   * URL, or vault path. Reducer normalizes and uses it as a dedup primary
   * key (see `Entity.definedIn`).
   */
  definedIn: z.string().min(1).optional(),
});
export type EntityFragment = z.infer<typeof EntityFragment>;

export const EdgeFragment = z.object({
  fromTempId: z.string().min(1),
  toTempId: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
});
export type EdgeFragment = z.infer<typeof EdgeFragment>;

export const ExtractorOutput = z.object({
  schemaVersion: z.literal(1),
  sourceRef: z.string().min(1),
  entities: z.array(EntityFragment).max(100),
  edges: z.array(EdgeFragment).max(200),
});
export type ExtractorOutput = z.infer<typeof ExtractorOutput>;

export const SidecarV1 = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  schema: z.object({
    entityTypes: z.array(EntityTypeDef),
    relationTypes: z.array(RelationTypeDef),
  }),
  entityGraph: EntityGraph,
  coordMap: z.record(z.string(), Coord),
  tombstones: z.array(z.string()),
  edgeTombstones: z.array(EdgeTombstone),
  lastRunAt: z.string().min(1),
});
export type SidecarV1 = z.infer<typeof SidecarV1>;
