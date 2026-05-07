import { describe, expect, it } from 'vitest';
import { autoSelect, layout, nodeSizeFor } from '@/agent/canvas/layouts';
import { DEFAULT_CANVAS_PALETTE_ID, paletteFor } from '@/agent/canvas/layouts/colorPalette';

const DEFAULT_COLORS = paletteFor(DEFAULT_CANVAS_PALETTE_ID).colors;
import type { Edge, Entity, EntityGraph } from '@/agent/canvas/schemas';

const BUDGETS = { freeSpacePadPx: 80, bboxPadding: 80 };

function ent(id: string, type: string, name = id, fields?: Record<string, unknown>): Entity {
  return { id, type, name, sources: [], ...(fields !== undefined ? { fields } : {}) };
}

function edge(from: string, to: string, type = 'rel'): Edge {
  return { id: `${from}|${to}|${type}`, from, to, type };
}

function graphOf(entities: Entity[], edges: Edge[] = []): EntityGraph {
  return { schemaVersion: 1, entities, edges };
}

describe('nodeSizeFor', () => {
  it('clamps width to [160, 480] and height to [80, 320]', () => {
    expect(nodeSizeFor({ type: 't', name: 'x' }).width).toBe(160);
    // 2-line label (name + type tag) → 2*24+48 = 96, clamps to ≥ 80.
    expect(nodeSizeFor({ type: 't', name: 'x' }).height).toBeGreaterThanOrEqual(80);
    expect(nodeSizeFor({ type: 't', name: 'x'.repeat(500) }).width).toBe(480);
  });
});

describe('layout — grid', () => {
  it('row-major; cols = ceil(sqrt(n)); sorted by type then name', () => {
    const g = graphOf([
      ent('z', 'b', 'zebra'),
      ent('a', 'a', 'apple'),
      ent('m', 'a', 'mango'),
      ent('c', 'b', 'cherry'),
    ]);
    const r = layout({ graph: g, preset: 'grid', budgets: BUDGETS });
    const ids = r.canvas.nodes.map((n) => n.id);
    expect(ids).toEqual(['a', 'm', 'c', 'z']);
  });
});

describe('layout — force packs trivial 1-node components in compact grid', () => {
  it('places 9 isolated singletons across multiple rows, not single horizontal strip', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 9; i += 1) entities.push(ent(`o${i}`, 't'));
    const g = graphOf(entities);
    const r = layout({ graph: g, preset: 'force', budgets: BUDGETS });
    const xs = r.canvas.nodes.map((n) => n.x);
    const ys = r.canvas.nodes.map((n) => n.y);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);
    expect(ySpread).toBeGreaterThan(0);
    expect(xSpread).toBeLessThan(9 * 240);
  });

  it('wraps regular components into multiple rows when total width exceeds cap', () => {
    const entities: Entity[] = [];
    const edges: Edge[] = [];
    for (let i = 0; i < 12; i += 1) {
      entities.push(ent(`a${i}`, 't'));
      entities.push(ent(`b${i}`, 't'));
      edges.push(edge(`a${i}`, `b${i}`));
    }
    const g = graphOf(entities, edges);
    const r = layout({ graph: g, preset: 'force', budgets: BUDGETS });
    const xs = r.canvas.nodes.map((n) => n.x);
    const ys = r.canvas.nodes.map((n) => n.y);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);
    expect(xSpread).toBeLessThan(3500);
    expect(ySpread).toBeGreaterThan(200);
  });

  it('emits FileNode when entity.filePath set', () => {
    const e: Entity = {
      id: 'p:alice',
      type: 'p',
      name: 'Alice',
      sources: [],
      filePath: 'people/alice.md',
    };
    const g = graphOf([e]);
    const r = layout({ graph: g, preset: 'force', budgets: BUDGETS });
    const node = r.canvas.nodes[0]!;
    expect(node.type).toBe('file');
    expect((node as { file: string }).file).toBe('people/alice.md');
  });
});

describe('layout — timeline', () => {
  it('orders by date|start|timestamp; falls back to grid when no temporal', () => {
    const g = graphOf([
      ent('a', 't', 'A', { start: '2026-01-01' }),
      ent('b', 't', 'B', { start: '2025-01-01' }),
      ent('c', 't', 'C'),
    ]);
    const r = layout({ graph: g, preset: 'timeline', budgets: BUDGETS });
    const ids = r.canvas.nodes.map((n) => n.id);
    expect(ids[0]).toBe('b');
    expect(ids[1]).toBe('a');

    const noDates = graphOf([ent('x', 't', 'X'), ent('y', 't', 'Y')]);
    const r2 = layout({ graph: noDates, preset: 'timeline', budgets: BUDGETS });
    expect(r2.canvas.nodes.length).toBe(2);
  });
});

describe('layout — radial', () => {
  it('hub at (0,0); ring-1 at radius r', () => {
    const g = graphOf(
      [ent('h', 't', 'hub'), ent('a', 't', 'A'), ent('b', 't', 'B')],
      [edge('h', 'a'), edge('h', 'b')],
    );
    const r = layout({ graph: g, preset: 'radial', budgets: BUDGETS });
    const hub = r.canvas.nodes.find((n) => n.id === 'h')!;
    expect(hub.x).toBe(0);
    expect(hub.y).toBe(0);
  });
});

describe('layout — bipartite', () => {
  it('two columns by entity-type cardinality', () => {
    const g = graphOf(
      [
        ent('p1', 'person'),
        ent('p2', 'person'),
        ent('p3', 'person'),
        ent('e1', 'event'),
        ent('e2', 'event'),
      ],
      [edge('p1', 'e1'), edge('p2', 'e1'), edge('p3', 'e2')],
    );
    const r = layout({ graph: g, preset: 'bipartite', budgets: BUDGETS });
    const ps = r.canvas.nodes.filter((n) => n.id.startsWith('p')).map((n) => n.x);
    const es = r.canvas.nodes.filter((n) => n.id.startsWith('e')).map((n) => n.x);
    expect(ps.every((x) => x === ps[0])).toBe(true);
    expect(es.every((x) => x === es[0])).toBe(true);
    expect(ps[0]).not.toBe(es[0]);
  });
});

describe('layout — tree fall-back to force on cycle', () => {
  it('cycle → fellBackTo === force', () => {
    const g = graphOf(
      [ent('a', 't'), ent('b', 't'), ent('c', 't')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    const r = layout({ graph: g, preset: 'tree', budgets: BUDGETS });
    expect(r.fellBackTo).toBe('force');
    expect(r.preset).toBe('force');
  });

  it('connected DAG → unique y per depth', () => {
    const g = graphOf(
      [ent('a', 't'), ent('b', 't'), ent('c', 't')],
      [edge('a', 'b'), edge('a', 'c')],
    );
    const r = layout({ graph: g, preset: 'tree', budgets: BUDGETS });
    expect(r.fellBackTo).toBeUndefined();
    const a = r.canvas.nodes.find((n) => n.id === 'a')!;
    const b = r.canvas.nodes.find((n) => n.id === 'b')!;
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe('layout — force determinism', () => {
  it('identical input ⇒ identical output (seeded)', () => {
    const g = graphOf(
      [ent('a', 't'), ent('b', 't'), ent('c', 't')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const r1 = layout({ graph: g, preset: 'force', budgets: BUDGETS });
    const r2 = layout({ graph: g, preset: 'force', budgets: BUDGETS });
    expect(r1.canvas.nodes).toEqual(r2.canvas.nodes);
  });
});

describe('layout — locked coords + free space', () => {
  it('locked coords are preserved; added entities placed right of locked bbox', () => {
    const g = graphOf([ent('a', 't'), ent('b', 't'), ent('new', 't')]);
    const r = layout({
      graph: g,
      preset: 'grid',
      lockedCoords: {
        a: { x: 0, y: 0, w: 200, h: 100 },
        b: { x: 0, y: 200, w: 200, h: 100 },
      },
      addedIds: new Set(['new']),
      budgets: BUDGETS,
    });
    const a = r.canvas.nodes.find((n) => n.id === 'a')!;
    const b = r.canvas.nodes.find((n) => n.id === 'b')!;
    const added = r.canvas.nodes.find((n) => n.id === 'new')!;
    expect(a.x).toBe(0);
    expect(b.y).toBe(200);
    expect(added.x).toBeGreaterThan(200);
  });
});

describe('layout — edge labels', () => {
  it('emits relation type as label when distinct relation types ≥ 2', () => {
    const g = graphOf(
      [ent('a', 't'), ent('b', 't')],
      [edge('a', 'b', 'k1'), { id: 'a|b|k2', from: 'a', to: 'b', type: 'k2' }],
    );
    const r = layout({ graph: g, preset: 'grid', budgets: BUDGETS });
    expect(r.canvas.edges[0]!.label).toBe('k1');
  });

  it('omits label when monotype', () => {
    const g = graphOf([ent('a', 't'), ent('b', 't')], [edge('a', 'b', 'k1')]);
    const r = layout({ graph: g, preset: 'grid', budgets: BUDGETS });
    expect(r.canvas.edges[0]!.label).toBeUndefined();
  });
});

describe('layout — color injection', () => {
  it('nodes and edges carry palette colors based on type frequency', () => {
    const g = graphOf(
      [
        ent('p1', 'person'),
        ent('p2', 'person'),
        ent('p3', 'person'),
        ent('e1', 'event'),
        ent('e2', 'event'),
      ],
      [
        edge('p1', 'e1', 'attends'),
        edge('p2', 'e1', 'attends'),
        { id: 'e1|e2|after', from: 'e1', to: 'e2', type: 'after' },
      ],
    );
    const r = layout({ graph: g, preset: 'grid', budgets: BUDGETS });
    const personColor = r.canvas.nodes.find((n) => n.id === 'p1')!.color;
    const eventColor = r.canvas.nodes.find((n) => n.id === 'e1')!.color;
    expect(personColor).toBe(DEFAULT_COLORS[0]);
    expect(eventColor).toBe(DEFAULT_COLORS[1]);
    const attends = r.canvas.edges.find((e) => e.id === 'p1|e1|attends')!;
    const after = r.canvas.edges.find((e) => e.id === 'e1|e2|after')!;
    expect(attends.color).toBe(DEFAULT_COLORS[0]);
    expect(after.color).toBe(DEFAULT_COLORS[1]);
  });
});

describe('layout — paletteId selects preset palette', () => {
  it('rainbow paletteId routes nodes/edges through rainbow colours', () => {
    const rainbow = paletteFor('rainbow').colors;
    const g = graphOf(
      [ent('p1', 'person'), ent('p2', 'person'), ent('e1', 'event')],
      [edge('p1', 'e1', 'attends')],
    );
    const r = layout({ graph: g, preset: 'grid', budgets: BUDGETS, paletteId: 'rainbow' });
    expect(r.canvas.nodes.find((n) => n.id === 'p1')!.color).toBe(rainbow[0]);
    expect(r.canvas.nodes.find((n) => n.id === 'e1')!.color).toBe(rainbow[1]);
    expect(r.canvas.edges[0]!.color).toBe(rainbow[0]);
  });

  it('omitted paletteId defaults to default palette', () => {
    const g = graphOf(
      [ent('p1', 'person'), ent('p2', 'person'), ent('e1', 'event')],
      [edge('p1', 'e1', 'attends'), edge('p2', 'e1', 'attends')],
    );
    const r = layout({ graph: g, preset: 'grid', budgets: BUDGETS });
    expect(r.canvas.nodes.find((n) => n.id === 'p1')!.color).toBe(DEFAULT_COLORS[0]);
  });
});

describe('layout — edge side routing', () => {
  it('picks horizontal sides when nodes lie horizontally', () => {
    const g = graphOf([ent('a', 't'), ent('b', 't')], [edge('a', 'b', 'rel')]);
    const r = layout({
      graph: g,
      preset: 'grid',
      lockedCoords: {
        a: { x: 0, y: 0, w: 200, h: 100 },
        b: { x: 600, y: 0, w: 200, h: 100 },
      },
      addedIds: new Set(),
      budgets: BUDGETS,
    });
    const e0 = r.canvas.edges[0]!;
    expect(e0.fromSide).toBe('right');
    expect(e0.toSide).toBe('left');
  });

  it('picks vertical sides when nodes lie vertically', () => {
    const g = graphOf([ent('a', 't'), ent('b', 't')], [edge('a', 'b', 'rel')]);
    const r = layout({
      graph: g,
      preset: 'grid',
      lockedCoords: {
        a: { x: 0, y: 0, w: 200, h: 100 },
        b: { x: 0, y: 400, w: 200, h: 100 },
      },
      addedIds: new Set(),
      budgets: BUDGETS,
    });
    const e0 = r.canvas.edges[0]!;
    expect(e0.fromSide).toBe('bottom');
    expect(e0.toSide).toBe('top');
  });
});

describe('autoSelect', () => {
  it('bipartite when 2 dominant types + 1 relation type', () => {
    const g = graphOf(
      [ent('p1', 'person'), ent('p2', 'person'), ent('e1', 'event'), ent('e2', 'event')],
      [edge('p1', 'e1', 'attends'), edge('p2', 'e2', 'attends')],
    );
    expect(autoSelect(g)).toBe('bipartite');
  });

  it('tree when acyclic + connected', () => {
    const g = graphOf(
      [ent('a', 't'), ent('b', 't'), ent('c', 't')],
      [edge('a', 'b'), edge('a', 'c')],
    );
    expect(autoSelect(g)).toBe('tree');
  });

  it('radial when single hub > 2× median degree', () => {
    // Add a back-edge to make the relation graph cyclic so `tree` falls through.
    const g = graphOf(
      [ent('h', 't'), ent('a', 't'), ent('b', 't'), ent('c', 't'), ent('d', 't'), ent('e', 't')],
      [
        edge('h', 'a'),
        edge('h', 'b'),
        edge('h', 'c'),
        edge('h', 'd'),
        edge('a', 'h'), // cycle h↔a
        edge('c', 'd'),
        edge('d', 'e'),
      ],
    );
    expect(autoSelect(g)).toBe('radial');
  });

  it('timeline when any entity has temporal field', () => {
    const g = graphOf(
      [ent('a', 't', 'A', { start: '2026-01-01' }), ent('b', 't', 'B'), ent('c', 't', 'C')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    expect(autoSelect(g)).toBe('timeline');
  });

  it('force as fallback', () => {
    const g = graphOf(
      [ent('a', 't'), ent('b', 't'), ent('c', 't')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    expect(autoSelect(g)).toBe('force');
  });
});
