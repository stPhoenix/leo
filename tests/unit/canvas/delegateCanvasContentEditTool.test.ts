import { describe, expect, it, vi } from 'vitest';
import {
  createDelegateCanvasContentEditTool,
  DELEGATE_CANVAS_CONTENT_EDIT_TOOL_ID,
} from '@/agent/canvas/tools/delegateCanvasContentEdit';
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
  entityGraph: { schemaVersion: 1, entities: [], edges: [] },
  coordMap: {},
  tombstones: ['ent-deleted-name'],
  edgeTombstones: [],
  lastRunAt: '2026-05-05T00:00:00.000Z',
};

const validCanvas = JSON.stringify({ nodes: [], edges: [] });

async function seedSidecar(vault: InMemoryVaultAdapter, canvasPath: string): Promise<void> {
  const sp = await sidecarPathFor(canvasPath);
  await vault.write(sp, JSON.stringify(validSidecar));
}

describe('delegate_canvas_content_edit tool', () => {
  it('id + requiresConfirmation', () => {
    const captured: { input?: StartCanvasInput } = {};
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: makeFakeOrch(captured, {
        ok: false,
        busy: { activeRunId: 'x', activeOp: 'content_edit' },
      }),
      confirmation: fakeConfirm('deny'),
    });
    expect(tool.id).toBe(DELEGATE_CANVAS_CONTENT_EDIT_TOOL_ID);
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('plan-mode allowlist includes tool (gated by per-call confirmation)', () => {
    expect(DEFAULT_PLAN_MODE_ALLOWLIST.has(DELEGATE_CANVAS_CONTENT_EDIT_TOOL_ID)).toBe(true);
  });

  it('rejects invalid path at validate boundary', () => {
    const captured: { input?: StartCanvasInput } = {};
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: makeFakeOrch(captured, {
        ok: false,
        busy: { activeRunId: 'x', activeOp: 'content_edit' },
      }),
      confirmation: fakeConfirm('allow'),
    });
    const r = tool.validate({ path: '../escape.canvas', instruction: 'edit' });
    expect(r.ok).toBe(false);
  });

  it('deny → denied:true, orchestrator never started', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'x', activeOp: 'content_edit' },
    });
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('deny'),
    });
    const vault = new InMemoryVaultAdapter();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', instruction: 'edit' },
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

  it('sidecar missing → sidecar_missing error', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'x', activeOp: 'content_edit' },
    });
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', instruction: 'edit' },
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

  it('canvas missing → canvas_parse_failed error', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'x', activeOp: 'content_edit' },
    });
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    await seedSidecar(vault, 'canvases/x.canvas');
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', instruction: 'edit' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'error' in payload) {
        expect(payload.error.code).toBe('canvas_parse_failed');
      }
    }
    expect(orch.start).not.toHaveBeenCalled();
  });

  it('happy path → orchestrator started with op:content_edit + initialSidecar', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const terminal: CanvasTerminalState = {
      phase: 'done',
      runId: 'r1',
      path: 'canvases/x.canvas',
      op: 'content_edit',
      durationMs: 50,
      paletteId: 'coolVivid',
    };
    const handle = {
      runId: 'r1',
      op: 'content_edit' as const,
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
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    await seedSidecar(vault, 'canvases/x.canvas');
    await vault.write('canvases/x.canvas', validCanvas);
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', instruction: 'add Alice' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    expect(orch.start).toHaveBeenCalledTimes(1);
    expect(captured.input?.op).toBe('content_edit');
    expect(captured.input?.targetPath).toBe('canvases/x.canvas');
    expect(captured.input?.initialSidecar?.tombstones).toEqual(['ent-deleted-name']);
    expect(captured.input?.editInstruction).toBe('add Alice');
  });

  it('busy → busy payload with op:content_edit', async () => {
    const captured: { input?: StartCanvasInput } = {};
    const orch = makeFakeOrch(captured, {
      ok: false,
      busy: { activeRunId: 'other', activeOp: 'content_edit' },
    });
    const tool = createDelegateCanvasContentEditTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const vault = new InMemoryVaultAdapter();
    await seedSidecar(vault, 'canvases/x.canvas');
    await vault.write('canvases/x.canvas', validCanvas);
    const result = await tool.invoke(
      { path: 'canvases/x.canvas', instruction: 'edit' },
      makeCtx(vault),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'error' in payload) {
        expect(payload.error.code).toBe('busy');
        expect(payload.activeOp).toBe('content_edit');
      }
    }
  });
});
