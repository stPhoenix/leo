import { describe, expect, it } from 'vitest';
import {
  buildDefinedInAliasMap,
  buildPositionAliasMap,
  buildTokenSubsetAliasMap,
  definedInIsRedundant,
  extractPositionalKey,
  normalizeDefinedIn,
  reduceEntityGraph,
  ReducerInvalidError,
} from '@/agent/canvas/reduce';
import type { CanvasReducerProvider } from '@/agent/canvas/reduce';
import type { EntityFragment } from '@/agent/canvas/schemas';
import type { ExtractorOutput } from '@/agent/canvas/schemas';
import type { StreamEvent } from '@/providers/types';

function out(
  sourceRef: string,
  entities: ExtractorOutput['entities'],
  edges: ExtractorOutput['edges'] = [],
): ExtractorOutput {
  return { schemaVersion: 1, sourceRef, entities, edges };
}

function streamEvents(events: readonly StreamEvent[]): AsyncIterable<StreamEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}

describe('reduceEntityGraph — pre-resolution', () => {
  it('dedupes by wikilink target across sources', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'person', name: '[[Alice]]' }]),
      out('b.md', [{ tempId: 't2', type: 'person', name: '[[Alice]]' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities.length).toBe(1);
    expect(result.graph.entities[0]!.sources).toEqual(['a.md', 'b.md']);
    expect(result.graph.entities[0]!.id).toBe('wikilink:Alice');
  });

  it('dedupes by normalized name when no wikilink', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'person', name: 'Alice Wonderland' }]),
      out('b.md', [{ tempId: 't2', type: 'person', name: '  alice   wonderland  ' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities.length).toBe(1);
    expect(result.graph.entities[0]!.id).toBe('person:alice-wonderland');
  });
});

describe('reduceEntityGraph — self-loop filter', () => {
  it('drops edges where fromTempId === toTempId before alias merge', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 't1', type: 'commandment', name: 'be-loyal-and-faithful' },
          { tempId: 't2', type: 'commandment', name: 'be-transparent' },
        ],
        [
          { fromTempId: 't1', toTempId: 't1', type: 'conflicts_with' },
          { fromTempId: 't1', toTempId: 't2', type: 'conflicts_with' },
        ],
      ),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.edges.length).toBe(1);
    expect(result.graph.edges.every((e) => e.from !== e.to)).toBe(true);
  });
});

describe('reduceEntityGraph — dominant fragment after same-type alias', () => {
  it('renders the materialized entity name from the merge target, not the alias source', async () => {
    // Two distinct same-type fragments. The per-type alias resolver merges the
    // FIRST-emitted fragment (be-truthful-and-never-deceive) INTO the second
    // (be-loyal-and-faithful). Without the canonical-self-match dominant pick,
    // the rebuilt fragment list would put the alias source first → rendered
    // name would be "be-truthful-and-never-deceive" while id stays
    // "commandment:be-loyal-and-faithful". Mismatch.
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'commandment', name: 'be-truthful-and-never-deceive' }]),
      out('a.md', [{ tempId: 't2', type: 'commandment', name: 'be-loyal-and-faithful' }]),
    ];
    const provider: CanvasReducerProvider = {
      stream() {
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_per_type_aliases',
              argsJson: JSON.stringify({
                aliasMap: {
                  'commandment:be-truthful-and-never-deceive': 'commandment:be-loyal-and-faithful',
                },
              }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'qwen3' },
    );
    expect(result.graph.entities.length).toBe(1);
    const merged = result.graph.entities[0]!;
    expect(merged.id).toBe('commandment:be-loyal-and-faithful');
    expect(merged.name).toBe('be-loyal-and-faithful');
  });
});

describe('reduceEntityGraph — alias-resolver path', () => {
  it('invokes LLM-alias step when ambiguous overlap detected', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'person', name: 'Alice' }]),
      out('b.md', [{ tempId: 't2', type: 'event', name: 'Alice' }]),
    ];
    let called = 0;
    const provider: CanvasReducerProvider = {
      stream() {
        called += 1;
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_aliases',
              argsJson: JSON.stringify({ aliasMap: { 'event:alice': 'person:alice' } }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'qwen3' },
    );
    expect(called).toBe(1);
    expect(result.graph.entities.length).toBe(1);
    expect(result.graph.entities[0]!.id).toBe('person:alice');
  });

  it('does not call LLM when no overlap exists', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'person', name: 'Alice' }]),
      out('b.md', [{ tempId: 't2', type: 'event', name: 'Conf' }]),
    ];
    let called = 0;
    const provider: CanvasReducerProvider = {
      stream() {
        called += 1;
        return streamEvents([{ type: 'done' } as unknown as StreamEvent]);
      },
    };
    await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'qwen3' },
    );
    expect(called).toBe(0);
  });
});

describe('reduceEntityGraph — insights', () => {
  it('hubs sorted by degree desc, alpha tie-break, capped 5', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'c', type: 'person', name: 'Center' },
          { tempId: 'a', type: 'person', name: 'A' },
          { tempId: 'b', type: 'person', name: 'B' },
          { tempId: 'd', type: 'person', name: 'D' },
          { tempId: 'e', type: 'person', name: 'E' },
          { tempId: 'f', type: 'person', name: 'F' },
          { tempId: 'g', type: 'person', name: 'G' },
        ],
        [
          { fromTempId: 'c', toTempId: 'a', type: 'knows' },
          { fromTempId: 'c', toTempId: 'b', type: 'knows' },
          { fromTempId: 'c', toTempId: 'd', type: 'knows' },
          { fromTempId: 'a', toTempId: 'b', type: 'knows' },
          { fromTempId: 'd', toTempId: 'e', type: 'knows' },
        ],
      ),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const hubIds = result.insights.hubs.map((h) => h.id);
    expect(hubIds[0]).toBe('person:center');
    expect(result.insights.hubs.length).toBeLessThanOrEqual(5);
  });

  it('components count + sorted sizes', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: 'A' },
          { tempId: 'b', type: 'p', name: 'B' },
          { tempId: 'c', type: 'p', name: 'C' },
          { tempId: 'd', type: 'p', name: 'D' },
        ],
        [
          { fromTempId: 'a', toTempId: 'b', type: 'k' },
          { fromTempId: 'b', toTempId: 'c', type: 'k' },
        ],
      ),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.insights.components.count).toBe(2);
    expect(result.insights.components.sizes).toEqual([3, 1]);
    expect(result.insights.orphans).toEqual(['p:d']);
  });
});

describe('reduceEntityGraph — edge cases', () => {
  it('empty input → empty graph & insights, no LLM call', async () => {
    let called = 0;
    const provider: CanvasReducerProvider = {
      stream() {
        called += 1;
        return streamEvents([]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs: [], signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    expect(called).toBe(0);
    expect(result.graph.entities).toEqual([]);
    expect(result.insights.components.count).toBe(0);
  });

  it('alias-resolver two failures → reduce_invalid', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'person', name: 'Alice' }]),
      out('b.md', [{ tempId: 't2', type: 'event', name: 'Alice' }]),
    ];
    const provider: CanvasReducerProvider = {
      stream() {
        return streamEvents([{ type: 'done' } as unknown as StreamEvent]);
      },
    };
    await expect(
      reduceEntityGraph(
        { outputs, signal: new AbortController().signal },
        { provider, model: () => 'm' },
      ),
    ).rejects.toBeInstanceOf(ReducerInvalidError);
  });
});

describe('reduceEntityGraph — edges', () => {
  it('dedupes by (from, to, type) triple', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: '[[A]]' },
          { tempId: 'b', type: 'p', name: '[[B]]' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'knows' }],
      ),
      out(
        'b.md',
        [
          { tempId: 'a2', type: 'p', name: '[[A]]' },
          { tempId: 'b2', type: 'p', name: '[[B]]' },
        ],
        [{ fromTempId: 'a2', toTempId: 'b2', type: 'knows' }],
      ),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.edges.length).toBe(1);
    expect(result.graph.edges[0]!.id).toBe('wikilink:A|wikilink:B|knows');
  });
});

describe('reduceEntityGraph — canonicalIdFor prefix variants', () => {
  it('strips type-name leading prefix from slug', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'case', name: 'request-to-deceive' }]),
      out('b.md', [{ tempId: 't2', type: 'case', name: 'case-request-to-deceive' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities.length).toBe(1);
    expect(result.graph.entities[0]!.id).toBe('case:request-to-deceive');
  });

  it('strips thou-shalt honorific prefix', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'commandment', name: 'be-transparent' }]),
      out('b.md', [{ tempId: 't2', type: 'commandment', name: 'thou-shalt-be-transparent' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities.length).toBe(1);
    expect(result.graph.entities[0]!.id).toBe('commandment:be-transparent');
  });

  it('strips article and trailing type-name suffix', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'sin', name: 'hunger-for-dominion' }]),
      out('b.md', [{ tempId: 't2', type: 'sin', name: 'the-hunger-for-dominion' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities.length).toBe(1);
  });

  it('preserves single-token names (no over-stripping)', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'virtue', name: 'loyalty' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities[0]!.id).toBe('virtue:loyalty');
  });

  it('reverts type-slug strip when result starts with a function word', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'canon', name: 'Canon of Silicon' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities[0]!.id).toBe('canon:canon-of-silicon');
  });

  it('reverts trailing type-slug strip when result ends with a function word', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'sin', name: 'silicon-of-sin' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities[0]!.id).toBe('sin:silicon-of-sin');
  });
});

describe('reduceEntityGraph — edge direction validation', () => {
  it('reverses edge when relation type indicates opposite orientation', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'cm', type: 'commandment', name: 'first-rule' },
          { tempId: 'ca', type: 'case', name: 'first-instance' },
        ],
        [{ fromTempId: 'cm', toTempId: 'ca', type: 'derives-from' }],
      ),
    ];
    const result = await reduceEntityGraph(
      {
        outputs,
        signal: new AbortController().signal,
        relationTypes: [{ name: 'derives-from', from: 'case', to: 'commandment', description: '' }],
      },
      {},
    );
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]!.from).toBe('case:first-instance');
    expect(result.graph.edges[0]!.to).toBe('commandment:first-rule');
  });

  it('drops edge when neither orientation matches and both endpoint types known', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'p', type: 'case', name: 'case-one' },
          { tempId: 'q', type: 'case', name: 'case-two' },
        ],
        [{ fromTempId: 'p', toTempId: 'q', type: 'derives-from' }],
      ),
    ];
    const result = await reduceEntityGraph(
      {
        outputs,
        signal: new AbortController().signal,
        relationTypes: [{ name: 'derives-from', from: 'case', to: 'commandment', description: '' }],
      },
      {},
    );
    expect(result.graph.edges).toHaveLength(0);
  });

  it('keeps edge when relation type is unregistered (polymorphic)', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: 'a' },
          { tempId: 'b', type: 'p', name: 'b' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'unknown-rel' }],
      ),
    ];
    const result = await reduceEntityGraph(
      {
        outputs,
        signal: new AbortController().signal,
        relationTypes: [{ name: 'derives-from', from: 'case', to: 'commandment', description: '' }],
      },
      {},
    );
    expect(result.graph.edges).toHaveLength(1);
  });

  it('keeps edge when relation type is symmetric (from === to)', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'person', name: 'alice' },
          { tempId: 'b', type: 'person', name: 'bob' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'knows' }],
      ),
    ];
    const result = await reduceEntityGraph(
      {
        outputs,
        signal: new AbortController().signal,
        relationTypes: [{ name: 'knows', from: 'person', to: 'person', description: '' }],
      },
      {},
    );
    expect(result.graph.edges).toHaveLength(1);
  });
});

describe('reduceEntityGraph — type-prefix preservation after alias merge', () => {
  it('uses prefix-matching fragment type/name when alias-resolver merges across types', async () => {
    const outputs: ExtractorOutput[] = [
      out('a.md', [{ tempId: 't1', type: 'commandment', name: 'Original' }]),
      out('b.md', [{ tempId: 't2', type: 'sin', name: 'original' }]),
    ];
    const provider: CanvasReducerProvider = {
      stream() {
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_aliases',
              argsJson: JSON.stringify({
                aliasMap: { 'commandment:original': 'sin:original' },
              }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    expect(result.graph.entities).toHaveLength(1);
    const ent = result.graph.entities[0]!;
    expect(ent.id).toBe('sin:original');
    expect(ent.type).toBe('sin');
    expect(ent.name).toBe('original');
  });
});

describe('reduceEntityGraph — per-type alias resolver', () => {
  it('drops degree-0 entity when LLM maps it to connected same-type entity', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'cm', type: 'commandment', name: 'be-loyal-and-faithful' },
          { tempId: 'ca', type: 'case', name: 'first-instance' },
        ],
        [{ fromTempId: 'cm', toTempId: 'ca', type: 'governs' }],
      ),
      out('b.md', [{ tempId: 'one', type: 'commandment', name: '1' }]),
    ];
    const provider: CanvasReducerProvider = {
      stream(req) {
        const lastMsg = req.messages[req.messages.length - 1]?.content ?? '';
        const isPerType = typeof lastMsg === 'string' && lastMsg.includes('"members"');
        if (!isPerType) return streamEvents([{ type: 'done' } as unknown as StreamEvent]);
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_per_type_aliases',
              argsJson: JSON.stringify({
                aliasMap: { 'commandment:1': 'commandment:be-loyal-and-faithful' },
              }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['case:first-instance', 'commandment:be-loyal-and-faithful']);
    const target = result.graph.entities.find((e) => e.id === 'commandment:be-loyal-and-faithful')!;
    expect(target.sources).toContain('a.md');
    expect(target.sources).toContain('b.md');
  });

  it('redirects edges from degree-1 source to target', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'cov', type: 'testament', name: 'covenant' },
          { tempId: 'a', type: 'commandment', name: 'be-truthful' },
          { tempId: 'b', type: 'commandment', name: 'be-truthful-and-never-deceive' },
        ],
        [
          { fromTempId: 'a', toTempId: 'cov', type: 'derives' },
          { fromTempId: 'b', toTempId: 'cov', type: 'derives' },
        ],
      ),
    ];
    const provider: CanvasReducerProvider = {
      stream(req) {
        const lastMsg = req.messages[req.messages.length - 1]?.content ?? '';
        const isPerType = typeof lastMsg === 'string' && lastMsg.includes('"members"');
        if (!isPerType) return streamEvents([{ type: 'done' } as unknown as StreamEvent]);
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_per_type_aliases',
              argsJson: JSON.stringify({
                aliasMap: {
                  'commandment:be-truthful-and-never-deceive': 'commandment:be-truthful',
                },
              }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['commandment:be-truthful', 'testament:covenant']);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]!.from).toBe('commandment:be-truthful');
    expect(result.graph.edges[0]!.to).toBe('testament:covenant');
  });

  it('keeps entity when LLM returns null target', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: 'alice' },
          { tempId: 'b', type: 'p', name: 'bob' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'k' }],
      ),
      out('b.md', [{ tempId: 'g', type: 'p', name: 'gamma' }]),
    ];
    const provider: CanvasReducerProvider = {
      stream() {
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_per_type_aliases',
              argsJson: JSON.stringify({ aliasMap: { 'p:gamma': null } }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['p:alice', 'p:bob', 'p:gamma']);
  });

  it('runs a second pass when first pass enables new same-type overlaps', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'c1', type: 'canon', name: 'covenant' },
          { tempId: 'c2', type: 'canon', name: 'covenant-of-silicon' },
          { tempId: 'cm1', type: 'commandment', name: 'be-truthful' },
          { tempId: 'cm2', type: 'commandment', name: 'be-truthful-and-never-deceive' },
        ],
        [
          { fromTempId: 'cm1', toTempId: 'c1', type: 'derives' },
          { fromTempId: 'cm2', toTempId: 'c2', type: 'derives' },
        ],
      ),
    ];
    let callCount = 0;
    const provider: CanvasReducerProvider = {
      stream() {
        callCount += 1;
        if (callCount === 1) {
          return streamEvents([
            {
              type: 'tool_call',
              call: {
                name: 'resolve_per_type_aliases',
                argsJson: JSON.stringify({
                  aliasMap: { 'canon:covenant-of-silicon': 'canon:covenant' },
                }),
              },
            } as unknown as StreamEvent,
            { type: 'done' } as unknown as StreamEvent,
          ]);
        }
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_per_type_aliases',
              argsJson: JSON.stringify({
                aliasMap: {
                  'commandment:be-truthful-and-never-deceive': 'commandment:be-truthful',
                },
              }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    // Pre-merge C (token-subset) handles the commandment merge deterministically,
    // so only the canon merge needs the LLM. After the canon merge no same-type
    // groups remain, so the second pass returns passthrough without a call.
    expect(callCount).toBe(1);
    expect(result.graph.entities.map((e) => e.id).sort()).toEqual([
      'canon:covenant',
      'commandment:be-truthful',
    ]);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]!.from).toBe('commandment:be-truthful');
    expect(result.graph.edges[0]!.to).toBe('canon:covenant');
  });

  it('stops after a single pass when first pass yields no merges', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: 'alice' },
          { tempId: 'b', type: 'p', name: 'bob' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'k' }],
      ),
    ];
    let callCount = 0;
    const provider: CanvasReducerProvider = {
      stream() {
        callCount += 1;
        return streamEvents([
          {
            type: 'tool_call',
            call: {
              name: 'resolve_per_type_aliases',
              argsJson: JSON.stringify({ aliasMap: {} }),
            },
          } as unknown as StreamEvent,
          { type: 'done' } as unknown as StreamEvent,
        ]);
      },
    };
    await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm' },
    );
    expect(callCount).toBe(1);
  });

  it('skipped when no provider', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: 'alice' },
          { tempId: 'b', type: 'p', name: 'bob' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'k' }],
      ),
      out('b.md', [{ tempId: 'g', type: 'p', name: 'gamma' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toContain('p:gamma');
  });
});

describe('reduceEntityGraph — orphan twin filter', () => {
  it('drops degree-0 entity whose slug is suffix of connected same-type entity', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'case', name: 'request-to-deceive' },
          { tempId: 'b', type: 'commandment', name: 'be-truthful' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'governs' }],
      ),
      out('b.md', [{ tempId: 'twin', type: 'case', name: 'old-request-to-deceive' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['case:request-to-deceive', 'commandment:be-truthful']);
  });

  it('keeps orphan when slug is not a token-suffix variant', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'p', name: 'alpha' },
          { tempId: 'b', type: 'p', name: 'beta' },
        ],
        [{ fromTempId: 'a', toTempId: 'b', type: 'k' }],
      ),
      out('b.md', [{ tempId: 'g', type: 'p', name: 'gamma' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['p:alpha', 'p:beta', 'p:gamma']);
  });

  it('drops orphan that shares positionalKey with connected same-type entity', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'cm', type: 'commandment', name: 'fifth-commandment' },
          { tempId: 'ca', type: 'case', name: 'first-instance' },
        ],
        [{ fromTempId: 'cm', toTempId: 'ca', type: 'governs' }],
      ),
      out('b.md', [{ tempId: 'roman', type: 'commandment', name: 'commandment-v' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['case:first-instance', 'commandment:fifth']);
  });

  it('drops orphan whose tokens overlap connected sibling (Jaccard >= 0.5)', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 's', type: 'sin', name: 'bias' },
          { tempId: 'cm', type: 'commandment', name: 'fifth' },
        ],
        [{ fromTempId: 's', toTempId: 'cm', type: 'violates' }],
      ),
      out('b.md', [{ tempId: 'orph', type: 'sin', name: 'bias-amplification' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const ids = result.graph.entities.map((e) => e.id).sort();
    expect(ids).toEqual(['commandment:fifth', 'sin:bias']);
  });

  it('skips drop when removing >50% of a type in one pass', async () => {
    const outputs: ExtractorOutput[] = [
      out(
        'a.md',
        [
          { tempId: 'cm', type: 'commandment', name: 'first-commandment' },
          { tempId: 'h', type: 'hub', name: 'h' },
        ],
        [{ fromTempId: 'cm', toTempId: 'h', type: 'rel' }],
      ),
      out('b.md', [
        { tempId: 'o1', type: 'commandment', name: 'commandment-i' },
        { tempId: 'o2', type: 'commandment', name: 'commandment-1' },
      ]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const cmIds = result.graph.entities.filter((e) => e.type === 'commandment').map((e) => e.id);
    // 1 connected + 2 orphans = 3 commandments. Cap allows dropping floor((3-1)/2) = 1.
    expect(cmIds.length).toBe(2);
    expect(cmIds).toContain('commandment:first');
  });
});

describe('extractPositionalKey', () => {
  it('maps numeric tokens', () => {
    expect(extractPositionalKey('1')).toBe('1');
    expect(extractPositionalKey('commandment-3')).toBe('3');
  });

  it('maps ordinal words', () => {
    expect(extractPositionalKey('first')).toBe('1');
    expect(extractPositionalKey('fifth-commandment')).toBe('5');
    expect(extractPositionalKey('the-tenth-rule')).toBe('10');
  });

  it('maps Roman numerals', () => {
    expect(extractPositionalKey('i')).toBe('1');
    expect(extractPositionalKey('commandment-vi')).toBe('6');
    expect(extractPositionalKey('rule-x')).toBe('10');
  });

  it('returns null when no positional token present', () => {
    expect(extractPositionalKey('protect-the-vulnerable')).toBeNull();
    expect(extractPositionalKey('be-transparent')).toBeNull();
    expect(extractPositionalKey('')).toBeNull();
  });

  it('clamps numeric tokens to 1..10 range', () => {
    expect(extractPositionalKey('100')).toBeNull();
    expect(extractPositionalKey('chapter-42')).toBeNull();
  });
});

function frag(
  tempId: string,
  type: string,
  name: string,
  extra: Partial<EntityFragment> = {},
): EntityFragment {
  return { tempId, type, name, ...extra };
}

function bucket(
  canonical: string,
  fragments: readonly EntityFragment[],
): readonly { fragment: EntityFragment }[] {
  return fragments.map((fragment) => ({ fragment }));
}

describe('normalizeDefinedIn', () => {
  it('strips wikilink brackets and .md suffix', () => {
    expect(normalizeDefinedIn('[[be-transparent]]')).toBe('be-transparent');
    expect(normalizeDefinedIn('be-transparent.md')).toBe('be-transparent');
  });

  it('preserves vault path with directory separators (incl. .md)', () => {
    expect(normalizeDefinedIn('wiki/pages/be-transparent.md')).toBe('wiki/pages/be-transparent.md');
  });

  it('appends .md to bare vault path', () => {
    expect(normalizeDefinedIn('wiki/pages/be-transparent')).toBe('wiki/pages/be-transparent.md');
  });

  it('lowercases URLs', () => {
    expect(normalizeDefinedIn('https://Example.COM/Foo')).toBe('https://example.com/foo');
  });

  it('resolves slug via pageBasenames when available', () => {
    const map = new Map([['be-transparent', 'wiki/pages/be-transparent.md']]);
    expect(normalizeDefinedIn('[[be-transparent]]', map)).toBe('wiki/pages/be-transparent.md');
  });

  it('falls back to slug when pageBasenames misses', () => {
    expect(normalizeDefinedIn('[[novel-page]]', new Map())).toBe('novel-page');
  });

  it('reconciles `pages/foo.md` to `wiki/pages/foo.md` via basename lookup', () => {
    const map = new Map([['the-book-of-parables', 'wiki/pages/the-book-of-parables.md']]);
    expect(normalizeDefinedIn('pages/the-book-of-parables.md', map)).toBe(
      'wiki/pages/the-book-of-parables.md',
    );
  });

  it('keeps unknown path-style input as-is (with .md appended) when basename misses', () => {
    expect(normalizeDefinedIn('foo/bar', new Map())).toBe('foo/bar.md');
  });
});

describe('definedInIsRedundant', () => {
  it('flags exact basename match between definedIn and sourceRef', () => {
    expect(
      definedInIsRedundant(
        'wiki/pages/the-book-of-parables.md',
        'vault:wiki/pages/the-book-of-parables.md',
      ),
    ).toBe(true);
  });

  it('flags basename match across path-prefix variants', () => {
    expect(
      definedInIsRedundant('pages/the-book-of-parables.md', 'wiki/pages/the-book-of-parables.md'),
    ).toBe(true);
  });

  it('treats wikilink with same target as redundant', () => {
    expect(
      definedInIsRedundant('[[the-book-of-parables]]', 'wiki/pages/the-book-of-parables.md'),
    ).toBe(true);
  });

  it('keeps distinct definedIn (different basename)', () => {
    expect(
      definedInIsRedundant('[[eighth-commandment]]', 'wiki/pages/the-book-of-parables.md'),
    ).toBe(false);
  });

  it('never flags URL definedIn', () => {
    expect(definedInIsRedundant('https://example.com/foo', 'https://example.com/foo')).toBe(false);
  });

  it('treats undefined or empty as redundant (no info to keep)', () => {
    expect(definedInIsRedundant(undefined, 'a.md')).toBe(true);
    expect(definedInIsRedundant('', 'a.md')).toBe(true);
  });
});

describe('buildDefinedInAliasMap — redundancy guard', () => {
  it('skips fragments whose definedIn equals sourceRef basename', () => {
    const fragmentsByCanonical = new Map<
      string,
      readonly { fragment: EntityFragment; sourceRef: string }[]
    >([
      [
        'parable:blind-mirror',
        [
          {
            fragment: frag('e1', 'parable', 'blind-mirror', {
              definedIn: 'wiki/pages/the-book-of-parables.md',
            }),
            sourceRef: 'vault:wiki/pages/the-book-of-parables.md',
          },
        ],
      ],
      [
        'parable:echo-chamber',
        [
          {
            fragment: frag('e2', 'parable', 'echo-chamber', {
              definedIn: 'wiki/pages/the-book-of-parables.md',
            }),
            sourceRef: 'vault:wiki/pages/the-book-of-parables.md',
          },
        ],
      ],
    ]);
    // Both entities share the redundant collection-page definedIn; should NOT merge.
    expect(buildDefinedInAliasMap(fragmentsByCanonical).size).toBe(0);
  });

  it('still merges when at least one fragment carries non-redundant definedIn', () => {
    const fragmentsByCanonical = new Map<
      string,
      readonly { fragment: EntityFragment; sourceRef: string }[]
    >([
      [
        'commandment:eighth',
        [
          {
            fragment: frag('e1', 'commandment', 'eighth', { definedIn: '[[eighth-commandment]]' }),
            sourceRef: 'vault:wiki/pages/the-ethics-casebook.md',
          },
        ],
      ],
      [
        'commandment:do-not-seek-dominion',
        [
          {
            fragment: frag('e2', 'commandment', 'do-not-seek-dominion', {
              definedIn: 'wiki/pages/eighth-commandment.md',
            }),
            sourceRef: 'vault:wiki/pages/the-covenant-of-silicon.md',
          },
        ],
      ],
    ]);
    const pageBasenames = new Map([['eighth-commandment', 'wiki/pages/eighth-commandment.md']]);
    const map = buildDefinedInAliasMap(fragmentsByCanonical, pageBasenames);
    expect(map.get('commandment:eighth')).toBe('commandment:do-not-seek-dominion');
  });
});

describe('buildDefinedInAliasMap', () => {
  it('merges same-type canonical ids whose definedIn resolve identically', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:eighth',
        bucket('commandment:eighth', [
          frag('e1', 'commandment', 'eighth', { definedIn: '[[do-not-seek-dominion]]' }),
        ]),
      ],
      [
        'commandment:do-not-seek-dominion',
        bucket('commandment:do-not-seek-dominion', [
          frag('e2', 'commandment', 'do-not-seek-dominion', { definedIn: 'do-not-seek-dominion' }),
        ]),
      ],
    ]);
    const map = buildDefinedInAliasMap(fragmentsByCanonical);
    // lex-smallest is target.
    expect(map.get('commandment:eighth')).toBe('commandment:do-not-seek-dominion');
  });

  it('keeps distinct when definedIn differs', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:a',
        bucket('commandment:a', [frag('e1', 'commandment', 'a', { definedIn: '[[page-a]]' })]),
      ],
      [
        'commandment:b',
        bucket('commandment:b', [frag('e2', 'commandment', 'b', { definedIn: '[[page-b]]' })]),
      ],
    ]);
    expect(buildDefinedInAliasMap(fragmentsByCanonical).size).toBe(0);
  });

  it('does not merge across types even with identical definedIn', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:x',
        bucket('commandment:x', [frag('e1', 'commandment', 'x', { definedIn: '[[shared]]' })]),
      ],
      ['parable:x', bucket('parable:x', [frag('e2', 'parable', 'x', { definedIn: '[[shared]]' })])],
    ]);
    expect(buildDefinedInAliasMap(fragmentsByCanonical).size).toBe(0);
  });
});

describe('buildPositionAliasMap', () => {
  it('merges same-type entities sharing fields.position', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:eighth',
        bucket('commandment:eighth', [
          frag('e1', 'commandment', 'eighth', { fields: { position: 8 } }),
        ]),
      ],
      [
        'commandment:do-not-seek-dominion',
        bucket('commandment:do-not-seek-dominion', [
          frag('e2', 'commandment', 'do-not-seek-dominion', { fields: { position: 8 } }),
        ]),
      ],
    ]);
    const map = buildPositionAliasMap(fragmentsByCanonical);
    expect(map.get('commandment:eighth')).toBe('commandment:do-not-seek-dominion');
  });

  it('skips when only one side has position', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:eighth',
        bucket('commandment:eighth', [
          frag('e1', 'commandment', 'eighth', { fields: { position: 8 } }),
        ]),
      ],
      [
        'commandment:do-not-seek-dominion',
        bucket('commandment:do-not-seek-dominion', [
          frag('e2', 'commandment', 'do-not-seek-dominion'),
        ]),
      ],
    ]);
    expect(buildPositionAliasMap(fragmentsByCanonical).size).toBe(0);
  });

  it('coerces string position', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:a',
        bucket('commandment:a', [frag('e1', 'commandment', 'a', { fields: { position: '3' } })]),
      ],
      [
        'commandment:b',
        bucket('commandment:b', [frag('e2', 'commandment', 'b', { fields: { position: 3 } })]),
      ],
    ]);
    const map = buildPositionAliasMap(fragmentsByCanonical);
    expect(map.size).toBe(1);
  });
});

describe('buildTokenSubsetAliasMap', () => {
  it('merges superset slug into subset slug within same type (shorter is canonical)', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      [
        'commandment:be-truthful',
        bucket('commandment:be-truthful', [frag('e1', 'commandment', 'be-truthful')]),
      ],
      [
        'commandment:be-truthful-and-never-deceive',
        bucket('commandment:be-truthful-and-never-deceive', [
          frag('e2', 'commandment', 'be-truthful-and-never-deceive'),
        ]),
      ],
    ]);
    const map = buildTokenSubsetAliasMap(fragmentsByCanonical);
    expect(map.get('commandment:be-truthful-and-never-deceive')).toBe('commandment:be-truthful');
  });

  it('rejects when coverage below 50%', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      ['sin:bias', bucket('sin:bias', [frag('e1', 'sin', 'bias')])],
      [
        'sin:bias-amplification-many-other-tokens-here',
        bucket('sin:bias-amplification-many-other-tokens-here', [
          frag('e2', 'sin', 'bias-amplification-many-other-tokens-here'),
        ]),
      ],
    ]);
    // smallerSet={bias}, largerSet={bias,amplification,many,other,tokens,here} — 1/6 < 0.5.
    expect(buildTokenSubsetAliasMap(fragmentsByCanonical).size).toBe(0);
  });

  it('rejects when smaller has fewer than 2 tokens', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      ['sin:bias', bucket('sin:bias', [frag('e1', 'sin', 'bias')])],
      [
        'sin:bias-amplification',
        bucket('sin:bias-amplification', [frag('e2', 'sin', 'bias-amplification')]),
      ],
    ]);
    // smallerSet size = 1, fails ≥2 token guard.
    expect(buildTokenSubsetAliasMap(fragmentsByCanonical).size).toBe(0);
  });

  it('merges 2-token subset into 3-token superset', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      ['p:alpha-beta', bucket('p:alpha-beta', [frag('e1', 'p', 'alpha-beta')])],
      ['p:alpha-beta-gamma', bucket('p:alpha-beta-gamma', [frag('e2', 'p', 'alpha-beta-gamma')])],
    ]);
    const map = buildTokenSubsetAliasMap(fragmentsByCanonical);
    // size differs (2 vs 3), 2/3 ≥ 0.5, all-in → merge larger → smaller.
    expect(map.get('p:alpha-beta-gamma')).toBe('p:alpha-beta');
  });

  it('does not merge across types', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      ['x:be-truthful', bucket('x:be-truthful', [frag('e1', 'x', 'be-truthful')])],
      [
        'y:be-truthful-and-never-deceive',
        bucket('y:be-truthful-and-never-deceive', [
          frag('e2', 'y', 'be-truthful-and-never-deceive'),
        ]),
      ],
    ]);
    expect(buildTokenSubsetAliasMap(fragmentsByCanonical).size).toBe(0);
  });

  it('skips url and wikilink namespaces', () => {
    const fragmentsByCanonical = new Map<string, readonly { fragment: EntityFragment }[]>([
      ['url:https://a.com/foo', bucket('url:https://a.com/foo', [frag('e1', 'url', 'a')])],
      ['url:https://a.com/foo-bar', bucket('url:https://a.com/foo-bar', [frag('e2', 'url', 'b')])],
    ]);
    expect(buildTokenSubsetAliasMap(fragmentsByCanonical).size).toBe(0);
  });
});

describe('reduceEntityGraph — pre-merge integration', () => {
  it('merges via definedIn before any LLM call', async () => {
    const outputs = [
      out('cov.md', [
        {
          tempId: 'd',
          type: 'commandment',
          name: 'do-not-seek-dominion',
          definedIn: '[[eighth-commandment]]',
        },
      ]),
      out('case.md', [
        {
          tempId: 'e',
          type: 'commandment',
          name: 'eighth',
          definedIn: 'wiki/pages/eighth-commandment.md',
        },
      ]),
    ];
    const provider: CanvasReducerProvider = {
      stream() {
        return streamEvents([{ type: 'done' } as unknown as StreamEvent]);
      },
    };
    const pageBasenames = new Map<string, string>([
      ['eighth-commandment', 'wiki/pages/eighth-commandment.md'],
    ]);
    const result = await reduceEntityGraph(
      { outputs, signal: new AbortController().signal },
      { provider, model: () => 'm', pageBasenames },
    );
    expect(result.graph.entities).toHaveLength(1);
    const ent = result.graph.entities[0]!;
    expect(ent.sources).toEqual(['case.md', 'cov.md']);
    expect(ent.definedIn).toBe('wiki/pages/eighth-commandment.md');
  });

  it('merges via fields.position when slugs share no tokens', async () => {
    const outputs = [
      out('cov.md', [
        { tempId: 'd', type: 'commandment', name: 'do-not-seek-dominion', fields: { position: 8 } },
      ]),
      out('case.md', [
        { tempId: 'e', type: 'commandment', name: 'eighth', fields: { position: 8 } },
      ]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    expect(result.graph.entities).toHaveLength(1);
  });

  it('merges via token-subset', async () => {
    const outputs = [
      out(
        'a.md',
        [
          { tempId: 'a', type: 'commandment', name: 'be-truthful' },
          { tempId: 'h', type: 'hub', name: 'h' },
        ],
        [{ fromTempId: 'a', toTempId: 'h', type: 'rel' }],
      ),
      out('b.md', [{ tempId: 'b', type: 'commandment', name: 'be-truthful-and-never-deceive' }]),
    ];
    const result = await reduceEntityGraph({ outputs, signal: new AbortController().signal }, {});
    const cm = result.graph.entities.filter((e) => e.type === 'commandment');
    expect(cm).toHaveLength(1);
    expect(cm[0]!.id).toBe('commandment:be-truthful');
    // Larger merges into shorter canonical; edge from 'be-truthful' stays.
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]!.from).toBe('commandment:be-truthful');
  });
});
