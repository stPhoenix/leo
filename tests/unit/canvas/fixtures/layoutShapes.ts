import type { EntityGraph } from '@/agent/canvas/schemas';

/**
 * Golden-file shapes covering the three canonical layout cases per preset:
 * small connected, two disconnected components, hub-and-spoke. Used by
 * F23 fixture coverage tests; deterministic.
 */

const ent = (id: string, type = 'leaf'): EntityGraph['entities'][number] => ({
  id,
  type,
  name: id,
  sources: [],
});

const edge = (
  id: string,
  from: string,
  to: string,
  type = 'links',
): EntityGraph['edges'][number] => ({ id, from, to, type });

export const SMALL_CONNECTED: EntityGraph = {
  schemaVersion: 1,
  entities: [ent('a'), ent('b'), ent('c'), ent('d')],
  edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')],
};

export const TWO_COMPONENTS: EntityGraph = {
  schemaVersion: 1,
  entities: [ent('a'), ent('b'), ent('c'), ent('d'), ent('e')],
  edges: [edge('e1', 'a', 'b'), edge('e2', 'd', 'e')],
};

export const HUB_AND_SPOKE: EntityGraph = {
  schemaVersion: 1,
  entities: [ent('hub', 'hub'), ent('a'), ent('b'), ent('c'), ent('d'), ent('e')],
  edges: [
    edge('e1', 'hub', 'a'),
    edge('e2', 'hub', 'b'),
    edge('e3', 'hub', 'c'),
    edge('e4', 'hub', 'd'),
    edge('e5', 'hub', 'e'),
  ],
};

export const ALL_SHAPES = {
  smallConnected: SMALL_CONNECTED,
  twoComponents: TWO_COMPONENTS,
  hubAndSpoke: HUB_AND_SPOKE,
} as const;
