import { describe, expect, it } from 'vitest';
import {
  buildBusyToolResult,
  buildCanvasToolResult,
  buildDeniedToolResult,
} from '@/agent/canvas/runPhase';
import type { CanvasTerminalState } from '@/agent/canvas/state';

describe('buildCanvasToolResult', () => {
  it('shapes DONE outcome with insights', () => {
    const t: CanvasTerminalState = {
      phase: 'done',
      runId: 'r1',
      path: 'canvases/x.canvas',
      op: 'create',
      durationMs: 100,
      paletteId: 'coolVivid',
      insights: {
        hubs: [],
        components: { count: 1, sizes: [3] },
        orphans: [],
        perTypeCount: { person: 3 },
      },
    };
    const r = buildCanvasToolResult(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.runId).toBe('r1');
      expect(r.path).toBe('canvases/x.canvas');
      expect(r.insights?.components.count).toBe(1);
      expect(r.durationMs).toBe(100);
    }
  });

  it('shapes CANCELLED outcome', () => {
    const t: CanvasTerminalState = {
      phase: 'cancelled',
      runId: 'r1',
      path: 'canvases/x.canvas',
      op: 'create',
      durationMs: 50,
      paletteId: 'coolVivid',
      partial: { fetchedSources: ['a.md'] },
    };
    const r = buildCanvasToolResult(t);
    expect(r.ok).toBe(false);
    if (!r.ok && 'cancelled' in r) {
      expect(r.cancelled).toBe(true);
      expect(r.partial?.fetchedSources).toEqual(['a.md']);
    }
  });

  it('shapes ERROR outcome with code+message', () => {
    const t: CanvasTerminalState = {
      phase: 'error',
      runId: 'r1',
      path: 'canvases/x.canvas',
      op: 'create',
      durationMs: 0,
      paletteId: 'coolVivid',
      error: { code: 'reduce_invalid', message: 'bad reduce' },
    };
    const r = buildCanvasToolResult(t);
    expect(r.ok).toBe(false);
    if (!r.ok && 'error' in r) {
      expect(r.error.code).toBe('reduce_invalid');
    }
  });
});

describe('buildBusyToolResult', () => {
  it('includes activeRunId / activeOp', () => {
    const r = buildBusyToolResult({ activeRunId: 'other', activeOp: 'create' });
    expect(r.ok).toBe(false);
    if (!r.ok && 'error' in r) {
      expect(r.error.code).toBe('busy');
      expect(r.activeRunId).toBe('other');
      expect(r.activeOp).toBe('create');
    }
  });
});

describe('buildDeniedToolResult', () => {
  it('returns denied:true', () => {
    const r = buildDeniedToolResult();
    expect(r.ok).toBe(false);
    if (!r.ok && 'denied' in r) {
      expect(r.denied).toBe(true);
    }
  });
});
