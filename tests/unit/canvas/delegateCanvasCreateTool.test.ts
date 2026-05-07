import { describe, expect, it, vi } from 'vitest';
import {
  createDelegateCanvasCreateTool,
  DELEGATE_CANVAS_CREATE_TOOL_ID,
} from '@/agent/canvas/tools/delegateCanvasCreate';
import type { CanvasOrchestrator } from '@/agent/canvas/orchestrator';
import type { CanvasStartResult } from '@/agent/canvas/orchestrator';
import type { CanvasTerminalState } from '@/agent/canvas/state';
import type { ConfirmationController } from '@/agent/confirmationController';
import type { ToolCtx } from '@/tools/types';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';
import { DEFAULT_PLAN_MODE_ALLOWLIST } from '@/agent/planModeController';

const noopEditor = {
  isActiveNote: () => false,
  applyActiveEdit: async () => ({ ok: false as const, error: 'noop' }),
};

function ctx(): ToolCtx {
  return {
    thread: 't1',
    signal: new AbortController().signal,
    vault: new InMemoryVaultAdapter(),
    editor: noopEditor,
  };
}

function fakeConfirm(decision: 'allow' | 'deny'): ConfirmationController {
  return { request: vi.fn(async () => decision) } as unknown as ConfirmationController;
}

function fakeOrch(result: CanvasStartResult): CanvasOrchestrator {
  return {
    start: vi.fn(async () => result),
    findHandle: vi.fn(() => null),
    liveHandlesSnapshot: vi.fn(() => []),
  } as unknown as CanvasOrchestrator;
}

describe('delegate_canvas_create tool', () => {
  it('id and requiresConfirmation registered correctly', () => {
    const tool = createDelegateCanvasCreateTool({
      orchestrator: fakeOrch({ ok: false, busy: { activeRunId: 'x', activeOp: 'create' } }),
      confirmation: fakeConfirm('deny'),
    });
    expect(tool.id).toBe(DELEGATE_CANVAS_CREATE_TOOL_ID);
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('plan-mode allowlist excludes delegate_canvas_create', () => {
    expect(DEFAULT_PLAN_MODE_ALLOWLIST.has(DELEGATE_CANVAS_CREATE_TOOL_ID)).toBe(false);
  });

  it('rejects invalid targetPath at validate boundary', () => {
    const tool = createDelegateCanvasCreateTool({
      orchestrator: fakeOrch({ ok: false, busy: { activeRunId: 'x', activeOp: 'create' } }),
      confirmation: fakeConfirm('allow'),
    });
    const r = tool.validate({ ask: 'build me a canvas', targetPath: '../escape.canvas' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/canvas_path_traversal/);
  });

  it('rejects targetPath without .canvas extension', () => {
    const tool = createDelegateCanvasCreateTool({
      orchestrator: fakeOrch({ ok: false, busy: { activeRunId: 'x', activeOp: 'create' } }),
      confirmation: fakeConfirm('allow'),
    });
    const r = tool.validate({ ask: 'build', targetPath: 'foo/bar.txt' });
    expect(r.ok).toBe(false);
  });

  it('deny → ok:true wrapper, denied:true payload, orchestrator never started', async () => {
    const orch = fakeOrch({ ok: false, busy: { activeRunId: 'x', activeOp: 'create' } });
    const tool = createDelegateCanvasCreateTool({
      orchestrator: orch,
      confirmation: fakeConfirm('deny'),
    });
    const result = await tool.invoke({ ask: 'build canvas' }, ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'denied' in payload) {
        expect(payload.denied).toBe(true);
      }
    }
    expect(orch.start).not.toHaveBeenCalled();
  });

  it('busy → busy payload with activeRunId/activeOp', async () => {
    const orch = fakeOrch({ ok: false, busy: { activeRunId: 'other-run', activeOp: 'create' } });
    const tool = createDelegateCanvasCreateTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const result = await tool.invoke({ ask: 'build canvas' }, ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(false);
      if (!payload.ok && 'error' in payload) {
        expect(payload.error.code).toBe('busy');
        expect(payload.activeRunId).toBe('other-run');
      }
    }
  });

  it('done → ok:true payload with insights', async () => {
    const terminal: CanvasTerminalState = {
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
    const handle = {
      runId: 'r1',
      op: 'create' as const,
      threadId: 't',
      originalAsk: 'build canvas',
      targetPath: 'canvases/x.canvas',
      abort: vi.fn(),
      terminal: Promise.resolve(terminal),
      subscribe: () => () => undefined,
    };
    const orch = fakeOrch({ ok: true, handle, terminal: Promise.resolve(terminal) });
    const tool = createDelegateCanvasCreateTool({
      orchestrator: orch,
      confirmation: fakeConfirm('allow'),
    });
    const result = await tool.invoke({ ask: 'build canvas' }, ctx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.data;
      expect(payload.ok).toBe(true);
      if (payload.ok) {
        expect(payload.runId).toBe('r1');
        expect(payload.insights?.components.count).toBe(1);
      }
    }
  });
});
