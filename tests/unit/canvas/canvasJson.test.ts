import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  parseCanvasJson,
  serializeCanvasJson,
  targetCanvasPathExists,
  validateSidecarRelativePath,
  validateVaultRelativePath,
} from '@/agent/canvas/canvasJson';
import type { CanvasJson } from '@/agent/canvas/canvasJson';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

const FIXTURES_DIR = join(__dirname, 'fixtures');

describe('parseCanvasJson — fixtures round-trip', () => {
  const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.canvas'));
  it('has at least one fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });
  for (const file of fixtures) {
    it(`round-trips ${file}`, () => {
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf8');
      const parsed = parseCanvasJson(raw);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const serialized = serializeCanvasJson(parsed.value);
      const reparsed = parseCanvasJson(serialized);
      expect(reparsed.ok).toBe(true);
      if (!reparsed.ok) return;
      expect(reparsed.value).toEqual(parsed.value);
    });
  }
});

describe('parseCanvasJson — rejects malformed', () => {
  it('rejects non-JSON', () => {
    const r = parseCanvasJson('not json');
    expect(r.ok).toBe(false);
  });
  it('rejects missing type', () => {
    const r = parseCanvasJson(
      JSON.stringify({ nodes: [{ id: 'n1', x: 0, y: 0, width: 1, height: 1 }], edges: [] }),
    );
    expect(r.ok).toBe(false);
  });
  it('rejects unknown node type', () => {
    const r = parseCanvasJson(
      JSON.stringify({
        nodes: [{ type: 'group', id: 'n1', x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
      }),
    );
    expect(r.ok).toBe(false);
  });
  it('rejects non-numeric coords', () => {
    const r = parseCanvasJson(
      JSON.stringify({
        nodes: [{ type: 'text', id: 'n1', x: '0', y: 0, width: 1, height: 1, text: 't' }],
        edges: [],
      }),
    );
    expect(r.ok).toBe(false);
  });
  it('rejects file node missing file', () => {
    const r = parseCanvasJson(
      JSON.stringify({
        nodes: [{ type: 'file', id: 'n1', x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe('targetCanvasPathExists', () => {
  it('returns false for missing', async () => {
    const adapter = new InMemoryVaultAdapter();
    expect(await targetCanvasPathExists(adapter, 'canvases/missing.canvas')).toBe(false);
  });
  it('returns true for existing', async () => {
    const adapter = new InMemoryVaultAdapter();
    await adapter.write('canvases/exists.canvas', '{}');
    expect(await targetCanvasPathExists(adapter, 'canvases/exists.canvas')).toBe(true);
  });
});

describe('validateVaultRelativePath', () => {
  it('accepts canvases/foo.canvas', () => {
    expect(validateVaultRelativePath('canvases/foo.canvas').ok).toBe(true);
  });
  it('rejects empty', () => {
    expect(validateVaultRelativePath('').ok).toBe(false);
  });
  it('rejects absolute', () => {
    expect(validateVaultRelativePath('/canvases/foo.canvas').ok).toBe(false);
  });
  it('rejects ..', () => {
    expect(validateVaultRelativePath('../escape.canvas').ok).toBe(false);
  });
  it('rejects nested ..', () => {
    expect(validateVaultRelativePath('canvases/../escape.canvas').ok).toBe(false);
  });
  it('rejects .md extension', () => {
    expect(validateVaultRelativePath('canvases/foo.md').ok).toBe(false);
  });
  it('rejects no extension', () => {
    expect(validateVaultRelativePath('canvases/foo').ok).toBe(false);
  });
  it('rejects backslash', () => {
    expect(validateVaultRelativePath('canvases\\foo.canvas').ok).toBe(false);
  });
});

describe('validateSidecarRelativePath', () => {
  it('accepts .leo/canvas/runs/<slug>.json', () => {
    expect(validateSidecarRelativePath('.leo/canvas/runs/abc-123.json').ok).toBe(true);
  });
  it('rejects outside prefix', () => {
    expect(validateSidecarRelativePath('canvases/foo.json').ok).toBe(false);
  });
  it('rejects parent traversal', () => {
    expect(validateSidecarRelativePath('.leo/canvas/runs/../escape.json').ok).toBe(false);
  });
  it('rejects non-json', () => {
    expect(validateSidecarRelativePath('.leo/canvas/runs/abc.txt').ok).toBe(false);
  });
  it('rejects empty', () => {
    expect(validateSidecarRelativePath('').ok).toBe(false);
  });
  it('rejects absolute', () => {
    expect(validateSidecarRelativePath('/.leo/canvas/runs/foo.json').ok).toBe(false);
  });
});

describe('serializeCanvasJson — stable key order', () => {
  it('emits keys alphabetically', () => {
    const value: CanvasJson = {
      nodes: [
        {
          type: 'text',
          id: 'n1',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          text: 't',
          color: '1',
        },
      ],
      edges: [],
    };
    const out = serializeCanvasJson(value);
    expect(out).toMatchSnapshot();
    const keysTopLevel = Object.keys(JSON.parse(out));
    expect(keysTopLevel).toEqual(['edges', 'nodes']);
    const node0 = JSON.parse(out).nodes[0];
    expect(Object.keys(node0)).toEqual([
      'color',
      'height',
      'id',
      'text',
      'type',
      'width',
      'x',
      'y',
    ]);
  });
});
