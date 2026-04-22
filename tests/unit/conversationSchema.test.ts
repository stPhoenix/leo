import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_SCHEMA_VERSION,
  emptyThread,
  parseThread,
  serializeThread,
  type StoredThread,
} from '@/storage/conversationSchema';

const ctx = { path: '.leo/conversations/default.json' };

describe('conversation schema round-trip', () => {
  it('serializes and parses an empty thread losslessly', () => {
    const original = emptyThread('default', '2026-04-21T00:00:00.000Z');
    const json = serializeThread(original);
    const parsed = parseThread(JSON.parse(json), ctx);
    expect(parsed).toEqual(original);
  });

  it('round-trips a thread with user + assistant messages and token usage', () => {
    const original: StoredThread = {
      id: 'default',
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:01:00.000Z',
      metadata: { allowedTools: ['read_note'], skillId: 'general' },
      messages: [
        { id: 'u1', role: 'user', content: 'hi', createdAt: '2026-04-21T00:00:30.000Z' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'hello',
          createdAt: '2026-04-21T00:00:40.000Z',
          status: 'done',
          tokens: { input: 5, output: 1, total: 6, source: 'api' },
        },
      ],
    };
    const parsed = parseThread(JSON.parse(serializeThread(original)), ctx);
    expect(parsed).toEqual(original);
  });

  it('preserves a tool_use + tool_result pair verbatim', () => {
    const original: StoredThread = {
      id: 'default',
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:05.000Z',
      metadata: { allowedTools: [], skillId: null },
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          createdAt: '2026-04-21T00:00:01.000Z',
          toolUse: { id: 't1', name: 'read_note', args: { path: 'a.md' } },
        },
        {
          id: 't1',
          role: 'tool',
          content: '',
          createdAt: '2026-04-21T00:00:02.000Z',
          toolResult: { id: 't1', ok: true, data: { content: 'body' } },
        },
      ],
    };
    const parsed = parseThread(JSON.parse(serializeThread(original)), ctx);
    expect(parsed).toEqual(original);
  });

  it('preserves unknown top-level fields and unknown per-message fields on round-trip', () => {
    const raw = {
      id: 'default',
      schemaVersion: 1,
      createdAt: 'x',
      updatedAt: 'y',
      metadata: { allowedTools: [], skillId: null, futureKey: 'hello' },
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'ok',
          createdAt: 'z',
          unknownPerMessage: { complex: true },
        },
      ],
      compactionSnapshot: { tokensRemaining: 12000 },
    };
    const parsed = parseThread(raw, ctx);
    const emitted = serializeThread(parsed);
    const reparsed = JSON.parse(emitted) as Record<string, unknown>;
    expect(reparsed.compactionSnapshot).toEqual({ tokensRemaining: 12000 });
    const md = reparsed.metadata as Record<string, unknown>;
    expect(md.futureKey).toBe('hello');
    const msg = (reparsed.messages as Array<Record<string, unknown>>)[0]!;
    expect(msg.unknownPerMessage).toEqual({ complex: true });
  });

  it('defaults metadata fields when absent so readers can rely on presence', () => {
    const parsed = parseThread(
      {
        id: 'default',
        schemaVersion: 1,
        createdAt: 'a',
        updatedAt: 'b',
        messages: [],
      },
      ctx,
    );
    expect(parsed.metadata.allowedTools).toEqual([]);
    expect(parsed.metadata.skillId).toBeNull();
  });

  it('throws on structurally incompatible root (non-object)', () => {
    expect(() => parseThread('nope', ctx)).toThrow();
  });

  it('emits a conversation.schema.unknown-field log event for each unknown key', () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger = {
      debug: () => undefined,
      info: (event: string, fields: Record<string, unknown>) => events.push({ event, fields }),
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Parameters<typeof parseThread>[1]['logger'];
    const raw = {
      id: 'default',
      schemaVersion: 1,
      createdAt: 'a',
      updatedAt: 'b',
      metadata: { allowedTools: [], skillId: null, futureKey: 1 },
      messages: [{ id: 'm1', role: 'user', content: 'x', createdAt: 'c', extraFuture: true }],
      extraRoot: { foo: 1 },
    };
    parseThread(raw, { logger, path: 'test.json' });
    const paths = events
      .filter((e) => e.event === 'conversation.schema.unknown-field')
      .map((e) => e.fields.field);
    expect(paths).toContain('metadata.futureKey');
    expect(paths).toContain('messages[0].extraFuture');
    expect(paths).toContain('extraRoot');
  });
});
