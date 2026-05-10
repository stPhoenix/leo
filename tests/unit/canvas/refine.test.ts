import { describe, expect, it } from 'vitest';
import { createCanvasRefine, getCanvasRefineSystemPromptViaImport } from './_refineHelpers';
import { coerceRunPlan } from '@/agent/canvas/refine';
import type { CanvasRefineProvider } from '@/agent/canvas/refine';
import { getCanvasRefineSystemPrompt } from '@/prompts/agent/canvas/refinePrompt';
import { RunPlan } from '@/agent/canvas/schemas';
import type { ProviderChatRequest, StreamEvent } from '@/providers/types';

function streamFromEvents(events: readonly StreamEvent[]): AsyncIterable<StreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

function fakeProvider(scripts: ReadonlyArray<readonly StreamEvent[]>): {
  provider: CanvasRefineProvider;
  calls: ProviderChatRequest[];
} {
  const calls: ProviderChatRequest[] = [];
  let i = 0;
  const provider: CanvasRefineProvider = {
    stream(req) {
      calls.push(req);
      const script = scripts[i++] ?? [];
      return streamFromEvents(script);
    },
  };
  return { provider, calls };
}

const VALID_PLAN = {
  plan: {
    schemaVersion: 1,
    entityTypes: [{ name: 'event', description: 'a meeting' }],
    relationTypes: [],
    sourceHints: [],
    layoutHint: 'auto',
    outputPath: 'canvases/foo.canvas',
  },
};

function planEvents(plan: unknown): StreamEvent[] {
  return [
    { type: 'tool_call', call: { name: 'emit_run_plan', argsJson: JSON.stringify(plan) } },
    { type: 'done' },
  ] as unknown as StreamEvent[];
}

function questionEvents(question: string): StreamEvent[] {
  return [
    {
      type: 'tool_call',
      call: { name: 'ask_clarifying_question', argsJson: JSON.stringify({ question }) },
    },
    { type: 'done' },
  ] as unknown as StreamEvent[];
}

describe('canvas refine — happy path', () => {
  it('returns plan on valid emit_run_plan', async () => {
    const { provider } = fakeProvider([planEvents(VALID_PLAN)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    const decision = await refine.step({
      originalAsk: 'show events and people',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('plan');
    if (decision.kind !== 'plan') return;
    expect(decision.plan.layoutHint).toBe('auto');
    expect(decision.plan.outputPath).toBe('canvases/foo.canvas');
  });

  it('returns question on ask_clarifying_question', async () => {
    const { provider } = fakeProvider([questionEvents('Which folder?')]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    const decision = await refine.step({
      originalAsk: 'show events',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('question');
    if (decision.kind !== 'question') return;
    expect(decision.question).toBe('Which folder?');
  });
});

describe('canvas refine — retry', () => {
  it('retries once on Zod parse failure with parser error injected', async () => {
    const invalidPlan = { plan: { ...VALID_PLAN.plan, layoutHint: 'cluster' } };
    const { provider, calls } = fakeProvider([planEvents(invalidPlan), planEvents(VALID_PLAN)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    const decision = await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('plan');
    expect(calls.length).toBe(2);
    const lastUserMsg = calls[1]!.messages.at(-1);
    expect(lastUserMsg?.role).toBe('user');
    expect(String(lastUserMsg?.content)).toMatch(/Plan validation failed/);
  });

  it('returns refine_invalid_plan after two parse failures', async () => {
    const invalidPlan = { plan: { ...VALID_PLAN.plan, layoutHint: 'cluster' } };
    const { provider } = fakeProvider([planEvents(invalidPlan), planEvents(invalidPlan)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    const decision = await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('error');
    if (decision.kind !== 'error') return;
    expect(decision.code).toBe('refine_invalid_plan');
  });
});

describe('canvas refine — schema enforcement', () => {
  it('rejects freeform layoutHint', async () => {
    const bad = { plan: { ...VALID_PLAN.plan, layoutHint: 'mermaid' } };
    const { provider } = fakeProvider([planEvents(bad), planEvents(bad)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    const decision = await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('error');
  });

  it('rejects missing outputPath', async () => {
    const { outputPath: _drop, ...rest } = VALID_PLAN.plan;
    const bad = { plan: rest };
    const { provider } = fakeProvider([planEvents(bad), planEvents(bad)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    const decision = await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('error');
  });
});

describe('canvas refine — system prompt + tools', () => {
  it('exposes system prompt', () => {
    expect(getCanvasRefineSystemPromptViaImport()).toBe(getCanvasRefineSystemPrompt());
    expect(getCanvasRefineSystemPrompt()).toContain('RunPlan');
  });

  it('only registers ask_clarifying_question and emit_run_plan as tools', async () => {
    const { provider, calls } = fakeProvider([planEvents(VALID_PLAN)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    const names = (calls[0]?.tools ?? []).map((t) => t.function.name).sort();
    expect(names).toEqual(['ask_clarifying_question', 'emit_run_plan']);
  });
});

describe('canvas refine — coerceRunPlan synonym coercion', () => {
  it('remaps sourceHint.kind synonyms to canonical literals', () => {
    const raw = {
      schemaVersion: 1,
      entityTypes: [{ name: 'event', description: 'a meeting' }],
      relationTypes: [],
      sourceHints: [
        { kind: 'glob', glob: '**/*.md' },
        { kind: 'tag', tag: 'foo' },
        { kind: 'frontmatter', field: 'type', value: 'doc' },
        { kind: 'note', path: 'people/alice.md' },
        { kind: 'mention', path: 'people/bob.md' },
      ],
      layoutHint: 'auto',
      outputPath: 'canvases/foo.canvas',
    };
    const out = coerceRunPlan(raw, undefined) as { sourceHints: Array<{ kind: string }> };
    expect(out.sourceHints.map((h) => h.kind)).toEqual([
      'vaultGlob',
      'vaultTag',
      'vaultFrontmatter',
      'mention',
      'mention',
    ]);
    expect(() => RunPlan.parse(out)).not.toThrow();
  });

  it('defaults missing relationTypes to empty array but leaves sourceHints alone', () => {
    const raw = {
      schemaVersion: 1,
      entityTypes: [{ name: 'event', description: 'a meeting' }],
      sourceHints: [{ kind: 'mention', path: 'a.md' }],
      layoutHint: 'auto',
      outputPath: 'canvases/foo.canvas',
    };
    const out = coerceRunPlan(raw, undefined) as {
      sourceHints: unknown[];
      relationTypes: unknown[];
    };
    expect(out.relationTypes).toEqual([]);
    expect(out.sourceHints.length).toBe(1);
    expect(() => RunPlan.parse(out)).not.toThrow();
  });

  it('does NOT default missing sourceHints — refine must reject the plan', () => {
    const raw = {
      schemaVersion: 1,
      entityTypes: [{ name: 'event', description: 'a meeting' }],
      relationTypes: [],
      layoutHint: 'auto',
      outputPath: 'canvases/foo.canvas',
    };
    const out = coerceRunPlan(raw, undefined) as { sourceHints?: unknown };
    expect(out.sourceHints).toBeUndefined();
    expect(() => RunPlan.parse(out)).toThrow();
  });

  it('leaves unknown kinds untouched (Zod will reject)', () => {
    const raw = {
      schemaVersion: 1,
      entityTypes: [{ name: 'event', description: 'a meeting' }],
      relationTypes: [],
      sourceHints: [{ kind: 'wat', glob: '**/*.md' }],
      layoutHint: 'auto',
      outputPath: 'canvases/foo.canvas',
    };
    const out = coerceRunPlan(raw, undefined) as { sourceHints: Array<{ kind: string }> };
    expect(out.sourceHints[0]?.kind).toBe('wat');
  });
});

describe('canvas refine — debug log on invalid plan', () => {
  it('logs candidate JSON at debug on first validation failure', async () => {
    const debugCalls: Array<{ event: string; data: unknown }> = [];
    const logger = {
      debug: (event: string, data?: unknown) => {
        debugCalls.push({ event, data });
      },
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Parameters<typeof createCanvasRefine>[0]['logger'];
    const invalidPlan = { plan: { ...VALID_PLAN.plan, layoutHint: 'cluster' } };
    const { provider } = fakeProvider([planEvents(invalidPlan), planEvents(VALID_PLAN)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3', logger });
    const decision = await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 0,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('plan');
    const candidateLogs = debugCalls.filter(
      (c) => (c.data as { stage?: string } | undefined)?.stage === 'invalid_plan_candidate',
    );
    expect(candidateLogs.length).toBeGreaterThanOrEqual(1);
    const first = candidateLogs[0]!.data as { candidateJson?: unknown; error?: unknown };
    expect(typeof first.candidateJson).toBe('string');
    expect(String(first.error)).toMatch(/layoutHint/);
  });
});

describe('canvas refine — clarification cap + tombstone summary', () => {
  it('returns refine_unresolved when questionCount >= cap', async () => {
    const { provider } = fakeProvider([]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3', maxClarifications: 3 });
    const decision = await refine.step({
      originalAsk: 'x',
      history: [],
      questionCount: 3,
      signal: new AbortController().signal,
    });
    expect(decision.kind).toBe('error');
    if (decision.kind !== 'error') return;
    expect(decision.code).toBe('refine_unresolved');
  });

  it('routes tombstone summary into the user context message', async () => {
    const { provider, calls } = fakeProvider([planEvents(VALID_PLAN)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    await refine.step({
      originalAsk: 'x',
      history: [],
      tombstoneSummary: 'previously removed: alice, bob',
      questionCount: 0,
      signal: new AbortController().signal,
    });
    const ctxMsg = calls[0]?.messages[1];
    expect(String(ctxMsg?.content)).toContain('previously removed: alice, bob');
  });

  it('threads targetPath as authoritative outputPath into context', async () => {
    const { provider, calls } = fakeProvider([planEvents(VALID_PLAN)]);
    const refine = createCanvasRefine({ provider, model: () => 'qwen3' });
    await refine.step({
      originalAsk: 'x',
      history: [],
      targetPath: 'foo/bar.canvas',
      questionCount: 0,
      signal: new AbortController().signal,
    });
    const ctxMsg = calls[0]?.messages[1];
    expect(String(ctxMsg?.content)).toContain('foo/bar.canvas');
  });
});
