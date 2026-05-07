import { describe, expect, it } from 'vitest';
import { layout } from '@/agent/canvas/layouts';
import { PRESET_IDS } from '@/agent/canvas/schemas';
import { CANVAS_BUDGETS } from '@/agent/canvas/budgets';
import { makeCanvasGraph } from './fixtures/makeCanvasGraph';

const ITERATIONS = 5;

function measure(fn: () => void): { p50: number; p95: number; runs: readonly number[] } {
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length / 2)] ?? 0;
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? p50;
  return { p50, p95, runs: samples };
}

describe('canvas layout perf — 50 / 200 nodes', () => {
  for (const n of [50, 200]) {
    for (const preset of PRESET_IDS) {
      it(`${preset} on ${n} nodes completes in budget`, () => {
        const graph = makeCanvasGraph(n);
        const r = measure(() => {
          layout({
            graph,
            preset,
            lockedCoords: {},
            addedIds: new Set(),
            budgets: {
              freeSpacePadPx: CANVAS_BUDGETS.freeSpacePadPx,
              bboxPadding: CANVAS_BUDGETS.bboxPadding,
            },
          });
        });
        // Sanity budget: O(n^2) repulsion in `force` can hit ~700ms cold-start
        // on a noisy CI runner; 1500ms gives stable headroom while still
        // catching real regressions (steady-state hot p95 is <80ms per REPORT).
        expect(r.p95).toBeLessThan(1500);
        if (process.env.CANVAS_BENCH === 'verbose') {
          // eslint-disable-next-line no-console
          console.log(
            `canvas.bench ${preset} n=${n} p50=${r.p50.toFixed(2)}ms p95=${r.p95.toFixed(2)}ms`,
          );
        }
      });
    }
  }
});
