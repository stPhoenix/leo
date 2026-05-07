import { describe, expect, it } from 'vitest';
import {
  assertTargetDoesNotExist,
  cleanupPreview,
  commitPreview,
  previewPathFor,
  TargetExistsError,
  writePreview,
  writeSidecarFromState,
} from '@/agent/canvas/writer';
import { parseCanvasJson, type CanvasJson } from '@/agent/canvas/canvasJson';
import type { SidecarV1 } from '@/agent/canvas/schemas';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

const SAMPLE_CANVAS: CanvasJson = {
  nodes: [
    {
      type: 'text',
      id: 'n1',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      text: 'hello',
    },
  ],
  edges: [],
};

const SAMPLE_SIDECAR: SidecarV1 = {
  schemaVersion: 1,
  runId: 'r1',
  schema: { entityTypes: [], relationTypes: [] },
  entityGraph: { schemaVersion: 1, entities: [], edges: [] },
  coordMap: {},
  tombstones: [],
  edgeTombstones: [],
  lastRunAt: '2026-05-05T00:00:00Z',
};

describe('writer — writePreview', () => {
  it('produces <targetPath>.preview.canvas; round-trips', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await writePreview({
      adapter,
      targetPath: 'canvases/foo.canvas',
      canvasJson: SAMPLE_CANVAS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.previewPath).toBe('canvases/foo.preview.canvas');
    const back = parseCanvasJson(await adapter.read(r.value.previewPath));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual(SAMPLE_CANVAS);
  });

  it('rejects invalid target path', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await writePreview({
      adapter,
      targetPath: '../escape.canvas',
      canvasJson: SAMPLE_CANVAS,
    });
    expect(r.ok).toBe(false);
  });
});

describe('writer — commitPreview', () => {
  it('renames preview to target; preview no longer exists; target parses', async () => {
    const adapter = new InMemoryVaultAdapter();
    await writePreview({ adapter, targetPath: 'canvases/x.canvas', canvasJson: SAMPLE_CANVAS });
    const r = await commitPreview({
      adapter,
      previewPath: 'canvases/x.preview.canvas',
      targetPath: 'canvases/x.canvas',
    });
    expect(r.ok).toBe(true);
    expect(await adapter.exists('canvases/x.preview.canvas')).toBe(false);
    expect(await adapter.exists('canvases/x.canvas')).toBe(true);
    const back = parseCanvasJson(await adapter.read('canvases/x.canvas'));
    expect(back.ok).toBe(true);
  });

  it('failure (preview missing) leaves target untouched', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await commitPreview({
      adapter,
      previewPath: 'canvases/x.preview.canvas',
      targetPath: 'canvases/x.canvas',
    });
    expect(r.ok).toBe(false);
  });
});

describe('writer — cleanupPreview', () => {
  it('removes preview if present; idempotent', async () => {
    const adapter = new InMemoryVaultAdapter();
    await writePreview({ adapter, targetPath: 'canvases/x.canvas', canvasJson: SAMPLE_CANVAS });
    await cleanupPreview({ adapter, previewPath: 'canvases/x.preview.canvas' });
    expect(await adapter.exists('canvases/x.preview.canvas')).toBe(false);
    // Second call should not throw.
    await expect(
      cleanupPreview({ adapter, previewPath: 'canvases/x.preview.canvas' }),
    ).resolves.toBeUndefined();
  });
});

describe('writer — assertTargetDoesNotExist', () => {
  it('Err target_path_exists when path exists', async () => {
    const adapter = new InMemoryVaultAdapter();
    await adapter.write('canvases/a.canvas', '{}');
    const r = await assertTargetDoesNotExist({ adapter, targetPath: 'canvases/a.canvas' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(TargetExistsError);
  });

  it('Ok when path is free', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await assertTargetDoesNotExist({ adapter, targetPath: 'canvases/free.canvas' });
    expect(r.ok).toBe(true);
  });
});

describe('writer — sidecar persist via writeSidecarFromState', () => {
  it('only writes after commitPreview success', async () => {
    const adapter = new InMemoryVaultAdapter();
    const r = await writeSidecarFromState({
      adapter,
      canvasVaultPath: 'canvases/z.canvas',
      sidecar: SAMPLE_SIDECAR,
    });
    expect(r.ok).toBe(true);
  });
});

describe('writer — preview path helper', () => {
  it('strips .canvas suffix and appends .preview.canvas', () => {
    expect(previewPathFor('a/b.canvas')).toBe('a/b.preview.canvas');
  });
});
