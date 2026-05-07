import { describe, expect, it } from 'vitest';
import {
  buildEntityTypePalette,
  buildRelationTypePalette,
  CANVAS_PALETTE_LIST,
  CANVAS_PALETTE_SIZE,
  CANVAS_PALETTES,
  colorAtRank,
  DEFAULT_CANVAS_PALETTE_ID,
  paletteFor,
  rankByFrequency,
  resolvePaletteId,
  type CanvasPaletteId,
} from '@/agent/canvas/layouts/colorPalette';

const DEFAULT_COLORS = paletteFor(DEFAULT_CANVAS_PALETTE_ID).colors;

describe('rankByFrequency', () => {
  it('orders descending by count, ties broken alphabetically', () => {
    const ordered = rankByFrequency(['b', 'a', 'a', 'c', 'b', 'a']);
    expect(ordered).toEqual(['a', 'b', 'c']);
  });

  it('alphabetical when all counts equal', () => {
    expect(rankByFrequency(['z', 'b', 'a'])).toEqual(['a', 'b', 'z']);
  });

  it('empty input → empty', () => {
    expect(rankByFrequency([])).toEqual([]);
  });
});

describe('colorAtRank', () => {
  it('defaults to default palette when paletteId omitted', () => {
    expect(colorAtRank(0)).toBe(DEFAULT_COLORS[0]);
    expect(colorAtRank(CANVAS_PALETTE_SIZE - 1)).toBe(DEFAULT_COLORS[CANVAS_PALETTE_SIZE - 1]);
    expect(colorAtRank(CANVAS_PALETTE_SIZE)).toBe(DEFAULT_COLORS[0]);
  });

  it('respects explicit paletteId', () => {
    const rainbow = paletteFor('rainbow').colors;
    expect(colorAtRank(0, 'rainbow')).toBe(rainbow[0]);
    expect(colorAtRank(5, 'rainbow')).toBe(rainbow[5]);
  });

  it('falls back to first slot on bad rank', () => {
    expect(colorAtRank(-1)).toBe(DEFAULT_COLORS[0]);
    expect(colorAtRank(NaN)).toBe(DEFAULT_COLORS[0]);
    expect(colorAtRank(-1, 'rainbow')).toBe(paletteFor('rainbow').colors[0]);
  });
});

describe('buildEntityTypePalette', () => {
  it('most-frequent type → first palette slot of chosen palette', () => {
    const types = ['p', 'p', 'p', 'e', 'e', 'r'];
    const sunset = paletteFor('sunset').colors;
    const map = buildEntityTypePalette(types, 'sunset');
    expect(map.get('p')).toBe(sunset[0]);
    expect(map.get('e')).toBe(sunset[1]);
    expect(map.get('r')).toBe(sunset[2]);
  });

  it('determinism: same input → same output ordering', () => {
    const a = buildEntityTypePalette(['x', 'y', 'x', 'z']);
    const b = buildEntityTypePalette(['z', 'y', 'x', 'x']);
    expect(a.get('x')).toBe(b.get('x'));
    expect(a.get('y')).toBe(b.get('y'));
    expect(a.get('z')).toBe(b.get('z'));
  });

  it('cycles palette indices when distinct types exceed palette size', () => {
    const types = Array.from({ length: CANVAS_PALETTE_SIZE + 2 }, (_, i) => `t${i}`);
    const map = buildEntityTypePalette(types);
    expect(map.get('t0')).toBe(DEFAULT_COLORS[0]);
    expect(map.get(`t${CANVAS_PALETTE_SIZE - 1}`)).toBe(DEFAULT_COLORS[CANVAS_PALETTE_SIZE - 1]);
    expect(map.get(`t${CANVAS_PALETTE_SIZE}`)).toBe(DEFAULT_COLORS[0]);
    expect(map.get(`t${CANVAS_PALETTE_SIZE + 1}`)).toBe(DEFAULT_COLORS[1]);
  });
});

describe('buildRelationTypePalette', () => {
  it('mirrors entity-type rank-by-frequency strategy with chosen palette', () => {
    const rels = ['attends', 'attends', 'organizes'];
    const monoOcean = paletteFor('monoOcean').colors;
    const map = buildRelationTypePalette(rels, 'monoOcean');
    expect(map.get('attends')).toBe(monoOcean[0]);
    expect(map.get('organizes')).toBe(monoOcean[1]);
  });
});

describe('palette presets', () => {
  it('default palette is coolVivid', () => {
    expect(DEFAULT_CANVAS_PALETTE_ID).toBe('coolVivid');
  });

  it('every preset has 6 distinct hex colours', () => {
    for (const preset of CANVAS_PALETTE_LIST) {
      expect(preset.colors.length).toBe(6);
      for (const c of preset.colors) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(new Set(preset.colors).size).toBe(6);
    }
  });

  it('exposes a registry indexed by id', () => {
    for (const preset of CANVAS_PALETTE_LIST) {
      expect(CANVAS_PALETTES.get(preset.id)).toBe(preset);
    }
  });

  it('ships rainbow + 5 other presets with stable ids', () => {
    const ids = CANVAS_PALETTE_LIST.map((p) => p.id);
    expect(ids).toContain('coolVivid');
    expect(ids).toContain('rainbow');
    expect(ids).toContain('forestSteel');
    expect(ids).toContain('pastelPlate');
    expect(ids).toContain('monoOcean');
    expect(ids).toContain('sunset');
  });
});

describe('resolvePaletteId', () => {
  it('passes through valid ids', () => {
    for (const preset of CANVAS_PALETTE_LIST) {
      expect(resolvePaletteId(preset.id)).toBe(preset.id satisfies CanvasPaletteId);
    }
  });

  it('falls back to default on unknown / non-string', () => {
    expect(resolvePaletteId('nonsense')).toBe(DEFAULT_CANVAS_PALETTE_ID);
    expect(resolvePaletteId(undefined)).toBe(DEFAULT_CANVAS_PALETTE_ID);
    expect(resolvePaletteId(null)).toBe(DEFAULT_CANVAS_PALETTE_ID);
    expect(resolvePaletteId(42)).toBe(DEFAULT_CANVAS_PALETTE_ID);
  });
});

describe('paletteFor', () => {
  it('returns a preset with the requested id', () => {
    expect(paletteFor('rainbow').id).toBe('rainbow');
  });

  it('falls back to default on unknown (defensive — runtime cast path)', () => {
    expect(paletteFor('bad' as CanvasPaletteId).id).toBe(DEFAULT_CANVAS_PALETTE_ID);
  });
});
