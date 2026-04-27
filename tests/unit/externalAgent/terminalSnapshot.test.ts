import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  ExternalAgentAdapter,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';
import {
  buildTerminalSnapshot,
  filterSecretFields,
  tryParseTerminalSnapshot,
  EXTERNAL_AGENT_WIDGET_KIND,
} from '@/agent/externalAgent/terminalSnapshot';
import { initialState } from '@/agent/externalAgent/state';

class StubAdapter extends ExternalAgentAdapter {
  readonly id = 'stub';
  readonly label = 'Stub';
  readonly defaultTimeoutMs = 1000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({
    apiKey: z.string().describe('secret'),
    model: z.string(),
    temperature: z.number(),
  });
  start(_i: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ value: undefined as unknown as ExternalEvent, done: true }),
      }),
    };
  }
}

describe('filterSecretFields', () => {
  it('drops fields tagged .describe("secret")', () => {
    const adapter = new StubAdapter();
    const filtered = filterSecretFields(adapter.configSchema, {
      apiKey: 'sk-secret',
      model: 'sonar',
      temperature: 0.5,
    });
    expect(filtered.apiKey).toBeUndefined();
    expect(filtered.model).toBe('sonar');
    expect(filtered.temperature).toBe(0.5);
  });

  it('returns empty object for non-object input', () => {
    const adapter = new StubAdapter();
    expect(filterSecretFields(adapter.configSchema, null)).toEqual({});
    expect(filterSecretFields(adapter.configSchema, 'string')).toEqual({});
  });
});

describe('buildTerminalSnapshot', () => {
  function baseState(overrides = {}): ReturnType<typeof initialState> {
    return {
      ...initialState({
        runId: 'r-1',
        threadId: 't-1',
        originalAsk: 'find me X',
        refineBudget: 3,
        selectedAdapterId: 'stub',
        timeoutMs: 1000,
      }),
      ...overrides,
    };
  }

  it('done state → terminalPhase=done with summary fields populated', () => {
    const adapter = new StubAdapter();
    const r = new AdapterRegistry();
    r.register(adapter);
    const snap = buildTerminalSnapshot({
      state: baseState({
        phase: 'done',
        startedAt: 1_000,
        endedAt: 4_000,
        textBuffer: 'a long body',
        resultFolder: 'externalAgentResults/r-1',
        writtenFiles: ['request.md', 'response.md'],
        refinedPrompt: 'final prompt body',
        refineHistory: [
          { role: 'user', content: 'find me X' },
          { role: 'assistant', content: 'final prompt body' },
        ],
      }),
      registry: r,
      resolvedConfig: { apiKey: 'sk-secret', model: 'sonar', temperature: 0.7 },
    });
    expect(snap.terminalPhase).toBe('done');
    expect(snap.adapterId).toBe('stub');
    expect(snap.adapterLabel).toBe('Stub');
    expect(snap.durationMs).toBe(3000);
    expect(snap.folder).toBe('externalAgentResults/r-1');
    expect(snap.files).toEqual(['request.md', 'response.md']);
    expect(snap.refineTranscript.length).toBe(2);
    expect(snap.adapterConfigSnapshot.apiKey).toBeUndefined();
    expect(snap.adapterConfigSnapshot.model).toBe('sonar');
  });

  it('error state with reload code carried through', () => {
    const adapter = new StubAdapter();
    const r = new AdapterRegistry();
    r.register(adapter);
    const snap = buildTerminalSnapshot({
      state: baseState({
        phase: 'error',
        error: { code: 'reload', message: 'Plugin reloaded during run' },
        startedAt: 1_000,
        endedAt: 1_500,
      }),
      registry: r,
      resolvedConfig: {},
    });
    expect(snap.terminalPhase).toBe('error');
    expect(snap.error?.code).toBe('reload');
  });
});

describe('round-trip serialize → JSON → deserialize', () => {
  it('preserves all fields', () => {
    const adapter = new StubAdapter();
    const r = new AdapterRegistry();
    r.register(adapter);
    const original = buildTerminalSnapshot({
      state: {
        ...initialState({
          runId: 'r-1',
          threadId: 't-1',
          originalAsk: 'a',
          refineBudget: 3,
          selectedAdapterId: 'stub',
          timeoutMs: 1000,
        }),
        phase: 'done',
        startedAt: 0,
        endedAt: 1,
        textBuffer: 'body',
        resultFolder: 'externalAgentResults/r-1',
        writtenFiles: ['response.md'],
        refinedPrompt: 'p',
        refineHistory: [{ role: 'user', content: 'a' }],
      },
      registry: r,
      resolvedConfig: { apiKey: 'sk', model: 'm', temperature: 0.5 },
    });
    const json = JSON.parse(JSON.stringify(original));
    const reparsed = tryParseTerminalSnapshot(json);
    expect(reparsed).not.toBeNull();
    if (reparsed === null) return;
    expect(reparsed).toEqual(original);
  });
});

describe('tryParseTerminalSnapshot', () => {
  it('returns null for missing required fields', () => {
    expect(tryParseTerminalSnapshot({ runId: 'x' })).toBeNull();
  });
  it('returns null for null / wrong type', () => {
    expect(tryParseTerminalSnapshot(null)).toBeNull();
    expect(tryParseTerminalSnapshot('a string')).toBeNull();
  });
});

describe('EXTERNAL_AGENT_WIDGET_KIND', () => {
  it('is the canonical block kind constant', () => {
    expect(EXTERNAL_AGENT_WIDGET_KIND).toBe('external_agent_widget');
  });
});
