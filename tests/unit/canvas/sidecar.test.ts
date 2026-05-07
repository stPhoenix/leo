import { describe, expect, it, vi } from 'vitest';
import { readSidecar, sidecarPathFor, writeSidecar } from '@/agent/canvas/sidecar';
import type { SidecarV1 } from '@/agent/canvas/schemas';
import type { Logger } from '@/platform/Logger';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

function makeSidecar(overrides: Partial<SidecarV1> = {}): SidecarV1 {
  return {
    schemaVersion: 1,
    runId: '20260505-101433-ab12cd',
    schema: { entityTypes: [], relationTypes: [] },
    entityGraph: { schemaVersion: 1, entities: [], edges: [] },
    coordMap: {},
    tombstones: [],
    edgeTombstones: [],
    lastRunAt: '2026-05-05T10:14:33Z',
    ...overrides,
  };
}

describe('sidecar — round-trip', () => {
  it('write then read returns equal value', async () => {
    const adapter = new InMemoryVaultAdapter();
    const sidecar = makeSidecar({
      coordMap: { 'a:1': { x: 0, y: 0, w: 100, h: 50 } },
      tombstones: ['x:1'],
    });
    const wrote = await writeSidecar({ adapter }, 'canvases/foo.canvas', sidecar);
    expect(wrote.ok).toBe(true);
    const read = await readSidecar({ adapter }, 'canvases/foo.canvas');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual(sidecar);
  });
});

describe('sidecar — version handling', () => {
  it('schemaVersion: 2 returns null and logs warn', async () => {
    const adapter = new InMemoryVaultAdapter();
    const path = await sidecarPathFor('canvases/x.canvas');
    await adapter.mkdir('.leo/canvas/runs');
    await adapter.write(path, JSON.stringify({ schemaVersion: 2, runId: 'r1' }));
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() } as unknown as Logger;
    const r = await readSidecar({ adapter, logger }, 'canvases/x.canvas');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'canvas.sidecar.versionMismatch',
      expect.objectContaining({ received: 2, expected: 1 }),
    );
  });
});

describe('sidecar — missing file', () => {
  it('returns null', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await readSidecar({ adapter }, 'canvases/never.canvas');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBeNull();
  });
});

describe('sidecar — corrupt JSON', () => {
  it('returns Err with sidecar_corrupt', async () => {
    const adapter = new InMemoryVaultAdapter();
    const path = await sidecarPathFor('canvases/x.canvas');
    await adapter.mkdir('.leo/canvas/runs');
    await adapter.write(path, '{not valid json');
    const r = await readSidecar({ adapter }, 'canvases/x.canvas');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('sidecar_corrupt');
  });

  it('returns Err for valid JSON but invalid schema', async () => {
    const adapter = new InMemoryVaultAdapter();
    const path = await sidecarPathFor('canvases/x.canvas');
    await adapter.mkdir('.leo/canvas/runs');
    await adapter.write(path, JSON.stringify({ schemaVersion: 1, runId: 'r' }));
    const r = await readSidecar({ adapter }, 'canvases/x.canvas');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('sidecar_corrupt');
  });
});

describe('sidecar — path confinement', () => {
  it('write target normalizes to .leo/canvas/runs/<slug>.json', async () => {
    const path = await sidecarPathFor('canvases/foo.canvas');
    expect(path.startsWith('.leo/canvas/runs/')).toBe(true);
    expect(path.endsWith('.json')).toBe(true);
  });

  it('atomic write: failure during rename leaves no partial sidecar', async () => {
    const adapter = new InMemoryVaultAdapter();
    const original = adapter.rename.bind(adapter);
    let renameCalls = 0;
    adapter.rename = async (_from: string, _to: string) => {
      renameCalls += 1;
      throw new Error('disk full');
    };
    const r = await writeSidecar({ adapter }, 'canvases/foo.canvas', makeSidecar());
    expect(r.ok).toBe(false);
    expect(renameCalls).toBe(1);
    const path = await sidecarPathFor('canvases/foo.canvas');
    expect(await adapter.exists(path)).toBe(false);
    expect(await adapter.exists(`${path}.tmp`)).toBe(false);
    adapter.rename = original;
  });
});
