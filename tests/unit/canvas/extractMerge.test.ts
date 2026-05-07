import { describe, expect, it, vi } from 'vitest';
import { mergeChunkOutputs } from '@/agent/canvas/extractMerge';
import type { ExtractorOutput } from '@/agent/canvas/schemas';

function out(args: Partial<ExtractorOutput> & { sourceRef?: string }): ExtractorOutput {
  return {
    schemaVersion: 1,
    sourceRef: args.sourceRef ?? 'a.md',
    entities: args.entities ?? [],
    edges: args.edges ?? [],
  };
}

describe('mergeChunkOutputs — single chunk passthrough', () => {
  it('rewrites tempIds to synth ids and rewrites edges', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [
            { tempId: 'e1', type: 'event', name: 'Conf' },
            { tempId: 'e2', type: 'person', name: 'Alice' },
          ],
          edges: [{ fromTempId: 'e2', toTempId: 'e1', type: 'attended' }],
        }),
      ],
    });
    expect(merged.entities.map((e) => e.tempId)).toEqual(['event::conf', 'person::alice']);
    expect(merged.edges).toEqual([
      { fromTempId: 'person::alice', toTempId: 'event::conf', type: 'attended' },
    ]);
  });
});

describe('mergeChunkOutputs — cross-chunk shared entity', () => {
  it('two chunks naming the same (type,name) collapse to one entity; edges remap', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [
            { tempId: 'e1', type: 'event', name: 'Conf' },
            { tempId: 'e2', type: 'person', name: 'Alice' },
          ],
          edges: [{ fromTempId: 'e2', toTempId: 'e1', type: 'attended' }],
        }),
        out({
          entities: [
            { tempId: 'x9', type: 'event', name: 'Conf' },
            { tempId: 'x8', type: 'person', name: 'Bob' },
          ],
          edges: [{ fromTempId: 'x8', toTempId: 'x9', type: 'attended' }],
        }),
      ],
    });
    expect(merged.entities.map((e) => e.tempId).sort()).toEqual([
      'event::conf',
      'person::alice',
      'person::bob',
    ]);
    const edgeKeys = merged.edges.map((e) => `${e.fromTempId}->${e.toTempId}:${e.type}`).sort();
    expect(edgeKeys).toEqual([
      'person::alice->event::conf:attended',
      'person::bob->event::conf:attended',
    ]);
  });

  it('shallow-merges entity fields with later-wins on conflict', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [{ tempId: 'e1', type: 'event', name: 'Conf', fields: { date: '2026-01' } }],
        }),
        out({
          entities: [
            { tempId: 'x1', type: 'event', name: 'Conf', fields: { date: '2026-02', city: 'SF' } },
          ],
        }),
      ],
      logger: logger as unknown as Parameters<typeof mergeChunkOutputs>[0]['logger'],
    });
    expect(merged.entities[0]?.fields).toEqual({ date: '2026-02', city: 'SF' });
    expect(logger.debug).toHaveBeenCalledWith(
      'canvas.extract.merge.field_conflict',
      expect.objectContaining({ entityId: 'event::conf', field: 'date' }),
    );
  });
});

describe('mergeChunkOutputs — dangling edge dropped', () => {
  it('chunk-local edge whose endpoints not in same chunk is dropped', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [{ tempId: 'e1', type: 'event', name: 'Conf' }],
          edges: [{ fromTempId: 'e1', toTempId: 'unknown', type: 'attended' }],
        }),
      ],
      logger: logger as unknown as Parameters<typeof mergeChunkOutputs>[0]['logger'],
    });
    expect(merged.edges).toEqual([]);
    expect(logger.debug).toHaveBeenCalledWith(
      'canvas.extract.merge.edge_dangling',
      expect.objectContaining({ ref: 'a.md', toTempId: 'unknown' }),
    );
  });
});

describe('mergeChunkOutputs — edge dedupe + label-wins', () => {
  it('duplicate edge triple deduped; later non-empty label wins', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [
            { tempId: 'a1', type: 'event', name: 'Conf' },
            { tempId: 'a2', type: 'person', name: 'Alice' },
          ],
          edges: [{ fromTempId: 'a2', toTempId: 'a1', type: 'attended', label: 'first' }],
        }),
        out({
          entities: [
            { tempId: 'b1', type: 'event', name: 'Conf' },
            { tempId: 'b2', type: 'person', name: 'Alice' },
          ],
          edges: [{ fromTempId: 'b2', toTempId: 'b1', type: 'attended', label: 'second' }],
        }),
      ],
    });
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]?.label).toBe('second');
  });

  it('later empty label keeps prior non-empty label', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [
            { tempId: 'a1', type: 'event', name: 'Conf' },
            { tempId: 'a2', type: 'person', name: 'Alice' },
          ],
          edges: [{ fromTempId: 'a2', toTempId: 'a1', type: 'attended', label: 'kept' }],
        }),
        out({
          entities: [
            { tempId: 'b1', type: 'event', name: 'Conf' },
            { tempId: 'b2', type: 'person', name: 'Alice' },
          ],
          edges: [{ fromTempId: 'b2', toTempId: 'b1', type: 'attended' }],
        }),
      ],
    });
    expect(merged.edges[0]?.label).toBe('kept');
  });
});

describe('mergeChunkOutputs — type distinguishes same-name entities', () => {
  it('same name + different type → distinct synth ids', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [
            { tempId: 'e1', type: 'person', name: 'Apollo' },
            { tempId: 'e2', type: 'project', name: 'Apollo' },
          ],
        }),
      ],
    });
    expect(merged.entities.map((e) => e.tempId).sort()).toEqual([
      'person::apollo',
      'project::apollo',
    ]);
  });
});

describe('mergeChunkOutputs — post-merge caps', () => {
  it('truncates at 100 entities + 200 edges and emits warn log', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const entities = Array.from({ length: 120 }, (_, i) => ({
      tempId: `e${i.toString()}`,
      type: 'event',
      name: `n${i.toString()}`,
    }));
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [out({ entities })],
      logger: logger as unknown as Parameters<typeof mergeChunkOutputs>[0]['logger'],
    });
    expect(merged.entities).toHaveLength(100);
    expect(logger.warn).toHaveBeenCalledWith(
      'canvas.extract.merged_truncated',
      expect.objectContaining({ entitiesBefore: 120, entitiesCap: 100 }),
    );
  });

  it('preserves definedIn from first chunk, fills from later chunk if missing', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [{ tempId: 'e1', type: 'commandment', name: 'eighth' }],
        }),
        out({
          entities: [
            {
              tempId: 'e1',
              type: 'commandment',
              name: 'eighth',
              definedIn: '[[eighth-commandment]]',
            },
          ],
        }),
      ],
    });
    expect(merged.entities).toHaveLength(1);
    expect(merged.entities[0]!.definedIn).toBe('[[eighth-commandment]]');
  });

  it('first-non-empty wins for definedIn across chunks', () => {
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [
        out({
          entities: [{ tempId: 'e1', type: 'cm', name: 'x', definedIn: 'first.md' }],
        }),
        out({
          entities: [{ tempId: 'e1', type: 'cm', name: 'x', definedIn: 'second.md' }],
        }),
      ],
    });
    expect(merged.entities[0]!.definedIn).toBe('first.md');
  });

  it('drops edges whose endpoints fall outside truncated entity set', () => {
    const entities = Array.from({ length: 110 }, (_, i) => ({
      tempId: `e${i.toString()}`,
      type: 'event',
      name: `n${i.toString()}`,
    }));
    const edges = [
      // both endpoints survive (n0 + n1 → first 100 entries)
      { fromTempId: 'e0', toTempId: 'e1', type: 'rel' },
      // toTempId points to n105 → dropped after entity truncation
      { fromTempId: 'e0', toTempId: 'e105', type: 'rel' },
    ];
    const merged = mergeChunkOutputs({
      sourceRef: 'a.md',
      chunkOutputs: [out({ entities, edges })],
    });
    expect(merged.entities).toHaveLength(100);
    const edgeKeys = merged.edges.map((e) => `${e.fromTempId}->${e.toTempId}`);
    expect(edgeKeys).toContain('event::n0->event::n1');
    expect(edgeKeys).not.toContain('event::n0->event::n105');
  });
});
