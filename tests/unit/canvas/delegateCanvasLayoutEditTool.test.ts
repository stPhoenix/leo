import { describe, expect, it, vi } from 'vitest';
import {
  createDelegateCanvasLayoutEditTool,
  DELEGATE_CANVAS_LAYOUT_EDIT_TOOL_ID,
} from '@/agent/canvas/tools/delegateCanvasLayoutEdit';
import type { CanvasOrchestrator, CanvasStartResult } from '@/agent/canvas/orchestrator';
import type { CanvasTerminalState } from '@/agent/canvas/state';
import type { ConfirmationController } from '@/agent/confirmationController';
import type { ToolCtx } from '@/tools/types';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';
import { sidecarPathFor } from '@/agent/canvas/sidecar';
import { DEFAULT_PLAN_MODE_ALLOWLIST } from '@/agent/planModeController';
import type { SidecarV1 } from '@/agent/canvas/schemas';
import type { StartCanvasInput } from '@/agent/canvas/subgraph';

const noopEditor = {
  isActiveNote: () => false,
  applyActiveEdit: async () => ({ ok: false as const, error: 'noop' }),
};

function makeCtx(vault: InMemoryVaultAdapter): ToolCtx {
  return {
    thread: 't1',
    signal: new AbortController().signal,
    vault,
    editor: noopEditor,
  };
}

function fakeConfirm(decision: 'allow' | 'deny'): ConfirmationController {
  return { request: vi.fn(async () => decision) } as unknown as ConfirmationController;
}

function makeFakeOrch(
  captured: { input?: StartCanvasInput },
  result: CanvasStartResult,
): CanvasOrchestrator {
  return {
    start: vi.fn(async (input: StartCanvasInput) => {
      captured.input = input;
      return result;
    }),
    findHandle: vi.fn(() => null),
    liveHandlesSnapshot: vi.fn(() => []),
  } as unknown as CanvasOrchestrator;
}

const validSidecar: SidecarV1 = {
  schemaVersion: 1,
  runId: 'r0',
  schema: { entityTypes: [], relationTypes: [] },
  entityGraph: {
    schemaVersion: 1,
    entities: [
      { id: 'e1', type: 'person', name: 'Alice', sources: [] },
      { id: 'e2', type: 'person', name: 'Bob', sources: [] },
    ],
    edges: [],
  },
  coordMap: {
    e1: { x: 10, y: 10, w: 200, h: 80 },
    e2: { x: 220, y: 10, w: 200, h: 80 },
  },
  tombstones: [],
  edgeTombstones: [],
  lastRunAt: '2026-05-05T00:00:00.000Z',
};

async function seedSidecar(vault: InMemoryVaultAdapter, canvasPath: string): Promise<void> {
  const sp = await sidecarPathFor(canvasPath);
  await vault.write(sp, JSON.stringify(validSidecar));
}

describe('delegate_canvas_layout_edit tool', () => {
  it('id + requiresConfirmation', () => {
    const captured: { input?: StartCanvasInput } = {};
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: makeFakeOrch(captured, {
        ok: false,
        busy: { activeRunId: 'x', activeOp: 'layout_edit' },
      }),
      confirmation: fakeConfirm('deny'),
    });
    expect(tool.id).toBe(DELEGATE_CANVAS_LAYOUT_EDIT_TOOL_ID);
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('plan-mode allowlist includes tool (gated by per-call confirmation)', () => {
    expect(DEFAULT_PLAN_MODE_ALLOWLIST.has(DELEGATE_CANVAS_LAYOUT_EDIT_TOOL_ID)).toBe(true);
  });

  it('rejects invalid path at validate boundary', () => {
    const captured: { input?: StartCanvasInput } = {};
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: makeFakeOrch(captured, {
        ok: false,
        busy: { activeRunId: 'x', activeOp: 'layout_edit' },
      }),
      confirmation: fakeConfirm('allow'),
    });
    const r = tool.validate({ path: '../escape.canvas', layoutAlgo: 'tree' });
    expect(r.ok).toBe(false);
  });

  it('accepts auto preset', () => {
    const captured: { input?: StartCanvasInput } = {};
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: makeFakeOrch(captured, {
        ok: false,
        busy: { activeRunId: 'x', activeOp: 'layout_edit' },
      }),
      confirmation: fakeConfirm('allow'),
    });
    const r = tool.validate({ path: 'canvases/x.canvas', layoutAlgo: 'auto' });
    expect(r.ok).toBe(true);
  });

  it('sidecar missing → sidecar_missing error', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'x', activeOp: 'layout_edit' },
    });
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', layoutAlgo: 'tree' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'error' in payload) {
        expect(payload.error.code).toBe('sidecar_missing');
      }
    }
    expect(orch.start).not.toHaveBeenCalled();
  });

  it('happy path → orchestrator started with op:layout_edit + initialSidecar + layoutAlgo', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const terminal: CanvasTerminalState = {
      phase: 'done',
      runId: 'r1',
      path: 'canvases/x.canvas',
      op: 'layout_edit',
      durationMs: 200,
      paletteId: 'coolVivid',
    };
    const handle = {
      runId: 'r1',
      op: 'layout_edit' as const,
      threadId: 't',
      originalAsk: '',
      targetPath: 'canvases/x.canvas',
      abort: vi.fn(),
      terminal: Promise.resolve(terminal),
      subscribe: () => () => undefined,
    };
    const orch = makeFakeOrch(captured, {
      ok: true,
      handle,
      terminal: Promise.resolve(terminal),
    });
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    await seedSidecar(vault, 'canvases/x.canvas');
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', layoutAlgo: 'tree' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    expect(orch.start).toHaveBeenCalledTimes(1);
    expect(captured.input?.op).toBe('layout_edit');
    expect(captured.input?.layoutAlgo).toBe('tree');
    expect(captured.input?.initialSidecar?.entityGraph.entities).toHaveLength(2);
  });

  it('busy → busy payload with op:layout_edit', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'other', activeOp: 'layout_edit' },
    });
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    await seedSidecar(vault, 'canvases/x.canvas');
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', layoutAlgo: 'grid' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'error' in payload) {
        expect(payload.error.code).toBe('busy');
        expect(payload.activeOp).toBe('layout_edit');
      }
    }
  });

  it('deny → denied:true', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'x', activeOp: 'layout_edit' },
    });
    const tool = createDelegateCanvasLayoutEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('deny'),
    });
    const vault = new InMemoryVaultAdapter();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', layoutAlgo: 'tree' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'denied' in payload) expect(payload.denied).toBe(true);
    }
    expect(orch.start).not.toHaveBeenCalled();
  });
});
