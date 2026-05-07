import { describe, expect, it } from 'vitest';
import {
  buildTombstoneSummary,
  clearTombstonesByName,
  diffAgainstSidecar,
  tryParseCurrentCanvas,
} from '@/agent/canvas/diff';
import type { CanvasJson } from '@/agent/canvas/canvasJson';
import type { EntityGraph, RunPlan, SidecarV1 } from '@/agent/canvas/schemas';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

function entityGraph(entities: { id: string; type: string; name: string }[]): EntityGraph {
  return {
    schemaVersion: 1,
    entities: entities.map((e) => ({ ...e, sources: [] })),
    edges: [],
  };
}

function sidecar(
  coords: Record<string, { x: number; y: number; w: number; h: number }>,
): SidecarV1 {
  return {
    schemaVersion: 1,
    runId: 'r1',
    schema: { entityTypes: [], relationTypes: [] },
    entityGraph: entityGraph(Object.keys(coords).map((id) => ({ id, type: 'p', name: id }))),
    coordMap: coords,
    tombstones: [],
    edgeTombstones: [],
    lastRunAt: '2026-05-05T00:00:00Z',
  };
}

function canvas(nodes: { id: string; x: number; y: number; w: number; h: number }[]): CanvasJson {
  return {
    nodes: nodes.map((n) => ({
      type: 'text',
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.w,
      height: n.h,
      text: n.id,
    })),
    edges: [],
  };
}

describe('diffAgainstSidecar — set classification', () => {
  it('kept when in both', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([{ id: 'a', type: 'p', name: 'A' }]),
      sidecar: sidecar({ a: { x: 0, y: 0, w: 100, h: 50 } }),
      currentCanvasJson: canvas([{ id: 'a', x: 0, y: 0, w: 100, h: 50 }]),
    });
    expect(r.kept[0]).toEqual({ id: 'a', locked: false });
  });

  it('added when in new but not sidecar', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([
        { id: 'a', type: 'p', name: 'A' },
        { id: 'b', type: 'p', name: 'B' },
      ]),
      sidecar: sidecar({ a: { x: 0, y: 0, w: 100, h: 50 } }),
      currentCanvasJson: canvas([{ id: 'a', x: 0, y: 0, w: 100, h: 50 }]),
    });
    expect(r.added).toEqual(['b']);
  });

  it('removed when in sidecar but not current canvas', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([{ id: 'a', type: 'p', name: 'A' }]),
      sidecar: sidecar({
        a: { x: 0, y: 0, w: 100, h: 50 },
        gone: { x: 200, y: 0, w: 100, h: 50 },
      }),
      currentCanvasJson: canvas([{ id: 'a', x: 0, y: 0, w: 100, h: 50 }]),
    });
    expect(r.removed).toEqual(['gone']);
  });
});

describe('diffAgainstSidecar — lock detection', () => {
  it('drift Δx = 20 → locked: true', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([{ id: 'a', type: 'p', name: 'A' }]),
      sidecar: sidecar({ a: { x: 0, y: 0, w: 100, h: 50 } }),
      currentCanvasJson: canvas([{ id: 'a', x: 20, y: 0, w: 100, h: 50 }]),
    });
    expect(r.kept[0]!.locked).toBe(true);
    expect(r.lockedCoords['a']).toEqual({ x: 20, y: 0, w: 100, h: 50 });
  });

  it('drift Δx = 8 → locked: false', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([{ id: 'a', type: 'p', name: 'A' }]),
      sidecar: sidecar({ a: { x: 0, y: 0, w: 100, h: 50 } }),
      currentCanvasJson: canvas([{ id: 'a', x: 8, y: 0, w: 100, h: 50 }]),
    });
    expect(r.kept[0]!.locked).toBe(false);
  });

  it('uses max(|Δx|, |Δy|) — y-axis drift triggers lock', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([{ id: 'a', type: 'p', name: 'A' }]),
      sidecar: sidecar({ a: { x: 0, y: 0, w: 100, h: 50 } }),
      currentCanvasJson: canvas([{ id: 'a', x: 0, y: 30, w: 100, h: 50 }]),
    });
    expect(r.kept[0]!.locked).toBe(true);
  });
});

describe('diffAgainstSidecar — edges', () => {
  it('sidecar edge missing in current canvas → edgesRemoved', () => {
    const sc: SidecarV1 = {
      schemaVersion: 1,
      runId: 'r1',
      schema: { entityTypes: [], relationTypes: [] },
      entityGraph: {
        schemaVersion: 1,
        entities: [
          { id: 'a', type: 'p', name: 'A', sources: [] },
          { id: 'b', type: 'p', name: 'B', sources: [] },
        ],
        edges: [{ id: 'a|b|attended', from: 'a', to: 'b', type: 'attended' }],
      },
      coordMap: {
        a: { x: 0, y: 0, w: 100, h: 50 },
        b: { x: 200, y: 0, w: 100, h: 50 },
      },
      tombstones: [],
      edgeTombstones: [],
      lastRunAt: '',
    };
    const r = diffAgainstSidecar({
      newGraph: entityGraph([
        { id: 'a', type: 'p', name: 'A' },
        { id: 'b', type: 'p', name: 'B' },
      ]),
      sidecar: sc,
      currentCanvasJson: { nodes: [], edges: [] },
    });
    expect(r.edgesRemoved).toEqual([{ from: 'a', to: 'b', type: 'attended' }]);
  });

  it('new edges always re-emit (not tombstoned)', () => {
    const r = diffAgainstSidecar({
      newGraph: entityGraph([{ id: 'a', type: 'p', name: 'A' }]),
      sidecar: sidecar({ a: { x: 0, y: 0, w: 100, h: 50 } }),
      currentCanvasJson: canvas([{ id: 'a', x: 0, y: 0, w: 100, h: 50 }]),
    });
    expect(r.edgesRemoved).toEqual([]);
  });
});

describe('tryParseCurrentCanvas', () => {
  it('returns Err canvas_parse_failed for malformed', async () => {
    const adapter = new InMemoryVaultAdapter();
    await adapter.write('a/b.canvas', '{not json');
    const r = await tryParseCurrentCanvas(adapter, 'a/b.canvas');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('canvas_parse_failed');
  });

  it('returns parsed canvas for valid', async () => {
    const adapter = new InMemoryVaultAdapter();
    await adapter.write('a/b.canvas', JSON.stringify({ nodes: [], edges: [] }));
    const r = await tryParseCurrentCanvas(adapter, 'a/b.canvas');
    expect(r.ok).toBe(true);
  });

  it('returns Err for missing file', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await tryParseCurrentCanvas(adapter, 'missing.canvas');
    expect(r.ok).toBe(false);
  });
});

describe('buildTombstoneSummary', () => {
  it('matches snapshot wording', () => {
    const summary = buildTombstoneSummary(
      ['p:alice', 'p:bob'],
      [{ from: 'p:alice', to: 'e:conf', type: 'attended' }],
    );
    expect(summary).toMatchSnapshot();
  });

  it('uses entity names when sidecar provided', () => {
    const sc: SidecarV1 = {
      schemaVersion: 1,
      runId: 'r',
      schema: { entityTypes: [], relationTypes: [] },
      entityGraph: {
        schemaVersion: 1,
        entities: [{ id: 'p:alice', type: 'p', name: 'Alice', sources: [] }],
        edges: [],
      },
      coordMap: {},
      tombstones: [],
      edgeTombstones: [],
      lastRunAt: '',
    };
    const summary = buildTombstoneSummary(['p:alice'], [], sc);
    expect(summary).toContain('Alice');
  });
});

describe('clearTombstonesByName', () => {
  it('clears tombstone when refined plan re-asks for the name (case-insensitive)', () => {
    const sc: SidecarV1 = {
      schemaVersion: 1,
      runId: 'r',
      schema: { entityTypes: [], relationTypes: [] },
      entityGraph: {
        schemaVersion: 1,
        entities: [
          { id: 'p:alice', type: 'p', name: 'Alice', sources: [] },
          { id: 'p:bob', type: 'p', name: 'Bob', sources: [] },
        ],
        edges: [],
      },
      coordMap: {},
      tombstones: ['p:alice', 'p:bob'],
      edgeTombstones: [],
      lastRunAt: '',
    };
    const refined: RunPlan = {
      schemaVersion: 1,
      entityTypes: [],
      relationTypes: [],
      sourceHints: [],
      layoutHint: 'auto',
      outputPath: 'canvases/x.canvas',
      scope: { filter: 'show ALICE again' },
    };
    const r = clearTombstonesByName(['p:alice', 'p:bob'], [], refined, sc);
    expect(r.tombstones).toEqual(['p:bob']);
  });
});
