import { describe, expect, it } from 'vitest';
import { layout } from '@/agent/canvas/layouts';
import { PRESET_IDS } from '@/agent/canvas/schemas';
import { CANVAS_BUDGETS } from '@/agent/canvas/budgets';
import { ALL_SHAPES } from './fixtures/layoutShapes';

describe('layout golden shapes — every preset survives every shape', () => {
  for (const preset of PRESET_IDS) {
    for (const [shapeName, graph] of Object.entries(ALL_SHAPES)) {
      it(`${preset} on ${shapeName}: produces canvas with one node per entity`, () => {
        const result = layout({
          graph,
          preset,
          lockedCoords: {},
          addedIds: new Set(graph.entities.map((e) => e.id)),
          budgets: {
            freeSpacePadPx: CANVAS_BUDGETS.freeSpacePadPx,
            bboxPadding: CANVAS_BUDGETS.bboxPadding,
          },
        });
        expect(result.canvas.nodes).toHaveLength(graph.entities.length);
        expect(result.canvas.edges).toHaveLength(graph.edges.length);
        for (const node of result.canvas.nodes) {
          expect(Number.isFinite(node.x)).toBe(true);
          expect(Number.isFinite(node.y)).toBe(true);
          expect(node.width).toBeGreaterThan(0);
          expect(node.height).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('layout golden shapes — all-locked re-run preserves coords', () => {
  for (const preset of PRESET_IDS) {
    it(`${preset}: all-locked → output coords match locked input`, () => {
      const graph = ALL_SHAPES.smallConnected;
      const lockedCoords: Record<string, { x: number; y: number; w: number; h: number }> = {
        a: { x: 0, y: 0, w: 200, h: 80 },
        b: { x: 240, y: 0, w: 200, h: 80 },
        c: { x: 480, y: 0, w: 200, h: 80 },
        d: { x: 720, y: 0, w: 200, h: 80 },
      };
      const result = layout({
        graph,
        preset,
        lockedCoords,
        addedIds: new Set(),
        budgets: {
          freeSpacePadPx: CANVAS_BUDGETS.freeSpacePadPx,
          bboxPadding: CANVAS_BUDGETS.bboxPadding,
        },
      });
      for (const node of result.canvas.nodes) {
        const lc = lockedCoords[node.id];
        if (lc !== undefined) {
          expect(node.x).toBe(lc.x);
          expect(node.y).toBe(lc.y);
        }
      }
    });
  }
});
