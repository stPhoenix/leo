import { describe, expect, it } from 'vitest';
import { collectCanvasStatus } from '@/agent/canvas/canvasStatus';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';
import { CanvasMutex } from '@/agent/canvas/mutex';
import { sidecarPathFor } from '@/agent/canvas/sidecar';

const sidecarV1 = (lastRunAt: string, runId = 'r0') => ({
  schemaVersion: 1,
  runId,
  schema: { entityTypes: [], relationTypes: [] },
  entityGraph: { schemaVersion: 1, entities: [], edges: [] },
  coordMap: {},
  tombstones: [],
  edgeTombstones: [],
  lastRunAt,
});

describe('collectCanvasStatus', () => {
  it('idle empty state — no active runs, no sidecars', async () => {
    const vault = new InMemoryVaultAdapter();
    const status = await collectCanvasStatus({ vault, mutex: new CanvasMutex() });
    expect(status.activeRuns).toEqual([]);
    expect(status.recentSidecars).toEqual([]);
    expect(status.sidecarDirError).toBeNull();
  });

  it('returns active run from mutex', async () => {
    const vault = new InMemoryVaultAdapter();
    const mutex = new CanvasMutex();
    mutex.acquire('canvases/x.canvas', 'r1', 'create');
    const status = await collectCanvasStatus({ vault, mutex });
    expect(status.activeRuns).toEqual([{ path: 'canvases/x.canvas', runId: 'r1', op: 'create' }]);
  });

  it('reads sidecars sorted by lastRunAt desc; capped', async () => {
    const vault = new InMemoryVaultAdapter();
    const sp1 = await sidecarPathFor('canvases/a.canvas');
    const sp2 = await sidecarPathFor('canvases/b.canvas');
    await vault.write(sp1, JSON.stringify(sidecarV1('2026-05-04T00:00:00Z', 'rA')));
    await vault.write(sp2, JSON.stringify(sidecarV1('2026-05-05T00:00:00Z', 'rB')));
    const status = await collectCanvasStatus({ vault, mutex: new CanvasMutex() });
    expect(status.recentSidecars).toHaveLength(2);
    expect(status.recentSidecars[0]?.runId).toBe('rB');
    expect(status.recentSidecars[1]?.runId).toBe('rA');
  });

  it('skips wrong schemaVersion', async () => {
    const vault = new InMemoryVaultAdapter();
    const sp = await sidecarPathFor('canvases/x.canvas');
    await vault.write(
      sp,
      JSON.stringify({ ...sidecarV1('2026-05-05T00:00:00Z'), schemaVersion: 99 }),
    );
    const status = await collectCanvasStatus({ vault, mutex: new CanvasMutex() });
    expect(status.recentSidecars).toEqual([]);
  });

  it('respects sidecarLimit', async () => {
    const vault = new InMemoryVaultAdapter();
    for (let i = 0; i < 5; i += 1) {
      const sp = await sidecarPathFor(`canvases/c${i}.canvas`);
      await vault.write(sp, JSON.stringify(sidecarV1(`2026-05-0${i + 1}T00:00:00Z`, `r${i}`)));
    }
    const status = await collectCanvasStatus({
      vault,
      mutex: new CanvasMutex(),
      sidecarLimit: 2,
    });
    expect(status.recentSidecars).toHaveLength(2);
  });
});
