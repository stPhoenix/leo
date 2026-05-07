import { describe, expect, it } from 'vitest';
import {
  startCanvasRun,
  type CanvasPhaseEvent,
  type SubgraphProvider,
} from '@/agent/canvas/subgraph';
import { CanvasMutex } from '@/agent/canvas/mutex';
import type { ProviderChatRequest, StreamEvent } from '@/providers/types';
import type { PreviewingDecisionAdapter } from '@/agent/canvas/state';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

function streamEvents(events: readonly StreamEvent[]): AsyncIterable<StreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

const VALID_PLAN = {
  schemaVersion: 1,
  entityTypes: [{ name: 'event', description: 'An event' }],
  relationTypes: [],
  sourceHints: [{ kind: 'mention', path: 'a.md' }],
  layoutHint: 'grid',
  outputPath: 'canvases/foo.canvas',
};

const VALID_EXTRACT = (sourceRef: string) => ({
  schemaVersion: 1,
  sourceRef,
  entities: [{ tempId: 't1', type: 'event', name: '[[Conf]]' }],
  edges: [],
});

interface ScriptedProvider extends SubgraphProvider {
  readonly callCount: () => number;
}

function makeProvider(handler: (req: ProviderChatRequest) => StreamEvent[]): ScriptedProvider {
  let count = 0;
  return {
    callCount: () => count,
    stream(req) {
      count += 1;
      return streamEvents(handler(req));
    },
  };
}

function provider(): ScriptedProvider {
  return makeProvider((req) => {
    const tools = req.tools ?? [];
    if (tools.some((t) => t.function.name === 'emit_run_plan')) {
      return [
        {
          type: 'tool_call',
          call: { name: 'emit_run_plan', argsJson: JSON.stringify({ plan: VALID_PLAN }) },
        },
        { type: 'done' },
      ] as unknown as StreamEvent[];
    }
    if (tools.some((t) => t.function.name === 'report_extraction')) {
      const userMsg = req.messages.find((m) => m.role === 'user');
      const ref =
        typeof userMsg?.content === 'string' && userMsg.content.startsWith('sourceRef:')
          ? userMsg.content.split('\n')[0]!.replace('sourceRef:', '').trim()
          : 'a.md';
      return [
        {
          type: 'tool_call',
          call: { name: 'report_extraction', argsJson: JSON.stringify(VALID_EXTRACT(ref)) },
        },
        { type: 'done' },
      ] as unknown as StreamEvent[];
    }
    return [{ type: 'done' } as unknown as StreamEvent];
  });
}

const approveAdapter: PreviewingDecisionAdapter = {
  async awaitDecision() {
    return { kind: 'approve' };
  },
};

describe('canvas subgraph — happy path', () => {
  it('drives create through all phases and ends DONE with insights', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      {
        threadId: 't',
        op: 'create',
        originalAsk: 'show events',
        targetPath: 'canvases/foo.canvas',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.phase).toBe('done');
    expect(term.path).toBe('canvases/foo.canvas');
    expect(term.insights).toBeDefined();
    expect(term.insights?.perTypeCount.event).toBe(1);
    // Sidecar written.
    expect(
      await vault.exists('.leo/canvas/runs/foo-' + 'placeholder'.slice(0, 0) + '_'.repeat(0)),
    ).toBe(false);
    // Verify a sidecar file exists at .leo/canvas/runs/.
    const listing = await vault.list('.leo/canvas/runs');
    expect(listing.files.length).toBeGreaterThan(0);
  });
});

describe('canvas subgraph — paletteId', () => {
  it('terminal state carries default paletteId when none supplied', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'show events', targetPath: 'canvases/p1.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.paletteId).toBe('coolVivid');
  });

  it('terminal state echoes explicit paletteId from input', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      {
        threadId: 't',
        op: 'create',
        originalAsk: 'show events',
        targetPath: 'canvases/p2.canvas',
        paletteId: 'rainbow',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.paletteId).toBe('rainbow');
  });

  it('falls back to default for unknown paletteId string', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      {
        threadId: 't',
        op: 'create',
        originalAsk: 'show events',
        targetPath: 'canvases/p3.canvas',
        // @ts-expect-error — runtime fallback path
        paletteId: 'nonsense',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.paletteId).toBe('coolVivid');
  });
});

describe('canvas subgraph — mutex', () => {
  it('second start against same path returns busy immediately', async () => {
    const mutex = new CanvasMutex();
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const r1 = startCanvasRun(
      {
        mutex,
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't1', op: 'create', originalAsk: 'x', targetPath: 'canvases/x.canvas' },
    );
    expect(r1.ok).toBe(true);
    const r2 = startCanvasRun(
      {
        mutex,
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't2', op: 'content_edit', originalAsk: 'y', targetPath: 'canvases/x.canvas' },
    );
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.busy.activeOp).toBe('create');
    if (r1.ok) await r1.handle.terminal;
  });
});

describe('canvas subgraph — error paths', () => {
  it('all sources fail → ERROR all_sources_failed', async () => {
    const vault = new InMemoryVaultAdapter();
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'all-fail', targetPath: 'canvases/x.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.phase).toBe('error');
    expect(term.error?.code).toBe('all_sources_failed');
  });

  it('target_path_exists when create against existing target', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    await vault.write('canvases/exists.canvas', '{}');
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'x', targetPath: 'canvases/exists.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.phase).toBe('error');
    expect(term.error?.code).toBe('target_path_exists');
  });

  it('mutex released on terminal (DONE)', async () => {
    const mutex = new CanvasMutex();
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const r = startCanvasRun(
      {
        mutex,
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'x', targetPath: 'canvases/y.canvas' },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await r.handle.terminal;
    expect(mutex.active('canvases/y.canvas')).toBeNull();
  });
});

describe('canvas subgraph — edit loop', () => {
  it('editIterationsMax exceeded → ERROR edit_iterations_exhausted', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    let edits = 0;
    const editAdapter: PreviewingDecisionAdapter = {
      async awaitDecision() {
        edits += 1;
        return { kind: 'edit', instruction: `edit ${edits}` };
      },
    };
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: editAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'x', targetPath: 'canvases/loop.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.phase).toBe('error');
    expect(term.error?.code).toBe('edit_iterations_exhausted');
  });

  it('cancel at PREVIEWING → CANCELLED + preview cleaned', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const cancelAdapter: PreviewingDecisionAdapter = {
      async awaitDecision() {
        return { kind: 'cancel' };
      },
    };
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: cancelAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'x', targetPath: 'canvases/c.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.phase).toBe('cancelled');
    expect(await vault.exists('canvases/c.preview.canvas')).toBe(false);
  });
});

describe('canvas subgraph — no_sources guard', () => {
  it('terminates with error.code=no_sources when expanded hints resolve to 0 items', async () => {
    const vault = new InMemoryVaultAdapter();
    const emptyHintProvider = makeProvider((req) => {
      const tools = req.tools ?? [];
      if (tools.some((t) => t.function.name === 'emit_run_plan')) {
        const plan = {
          ...VALID_PLAN,
          sourceHints: [{ kind: 'vaultGlob', glob: 'nonexistent/**/*.md' }],
        };
        return [
          {
            type: 'tool_call',
            call: { name: 'emit_run_plan', argsJson: JSON.stringify({ plan }) },
          },
          { type: 'done' },
        ] as unknown as StreamEvent[];
      }
      return [{ type: 'done' } as unknown as StreamEvent];
    });
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: emptyHintProvider,
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 't', op: 'create', originalAsk: 'x', targetPath: 'canvases/empty.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    expect(term.phase).toBe('error');
    expect(term.error?.code).toBe('no_sources');
  });
});

describe('canvas subgraph — RunHandle phase events', () => {
  it('subscribe receives phase transitions and unsubscribe stops further emits', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      {
        threadId: 't',
        op: 'create',
        originalAsk: 'subscribe-test',
        targetPath: 'canvases/sub.canvas',
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events: CanvasPhaseEvent[] = [];
    const unsubscribe = result.handle.subscribe((e) => events.push(e));
    await result.handle.terminal;
    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe('preparing');
    expect(phases).toContain('planning');
    expect(phases).toContain('previewing');
    expect(phases.at(-1)).toBe('done');
    const previewingWithPath = events.find(
      (e) => e.phase === 'previewing' && e.previewPath !== undefined,
    );
    expect(previewingWithPath?.previewPath).toBeDefined();
    const done = events.find((e) => e.phase === 'done');
    expect(done?.insights).toBeDefined();
    // unsubscribe is a no-op after terminal but must be a callable function.
    expect(typeof unsubscribe).toBe('function');
    const beforeCount = events.length;
    unsubscribe();
    expect(events.length).toBe(beforeCount);
  });

  it('exposes runtime metadata on the handle', () => {
    const vault = new InMemoryVaultAdapter();
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: provider(),
        model: () => 'm',
        previewing: approveAdapter,
      },
      { threadId: 'tx', op: 'create', originalAsk: 'meta-ask', targetPath: 'canvases/meta.canvas' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handle.op).toBe('create');
    expect(result.handle.threadId).toBe('tx');
    expect(result.handle.originalAsk).toBe('meta-ask');
    expect(result.handle.targetPath).toBe('canvases/meta.canvas');
    void result.handle.abort();
  });
});

describe('canvas subgraph — layout_edit', () => {
  it('skips planning/extracting/reducing/diffing and runs DONE in <1s for ≤50 nodes', async () => {
    const vault = new InMemoryVaultAdapter();
    const entities = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`,
      type: 'person',
      name: `Person ${i}`,
      sources: [],
    }));
    const coordMap: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (let i = 0; i < entities.length; i += 1) {
      coordMap[`e${i}`] = { x: (i % 6) * 240, y: Math.floor(i / 6) * 100, w: 200, h: 80 };
    }
    const sidecar = {
      schemaVersion: 1 as const,
      runId: 'r0',
      schema: { entityTypes: [], relationTypes: [] },
      entityGraph: { schemaVersion: 1 as const, entities, edges: [] },
      coordMap,
      tombstones: [],
      edgeTombstones: [],
      lastRunAt: '2026-05-05T00:00:00.000Z',
    };
    // No-call provider — layout_edit skips all LLM phases.
    const noCallProvider: SubgraphProvider = {
      stream() {
        throw new Error('layout_edit must not invoke provider');
      },
    };
    const start = Date.now();
    const result = startCanvasRun(
      {
        mutex: new CanvasMutex(),
        vault,
        provider: noCallProvider,
        model: () => 'm',
        previewing: approveAdapter,
      },
      {
        threadId: 't',
        op: 'layout_edit',
        originalAsk: 'relayout',
        targetPath: 'canvases/relayout.canvas',
        layoutAlgo: 'grid',
        initialSidecar: sidecar,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const term = await result.handle.terminal;
    const elapsed = Date.now() - start;
    expect(term.phase).toBe('done');
    expect(elapsed).toBeLessThan(1000);
  });
});
