import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_COMPACTABLE_TOOLS,
  CLEARED_CONTENT_MARKER,
  DEFAULT_GAP_THRESHOLD_MINUTES,
  DEFAULT_KEEP_RECENT,
  createMicrocompactBoundary,
  estimateCompactTokens,
  isMicrocompactBoundary,
  microcompactMessages,
  type CompactAssistantMessage,
  type CompactMessage,
  type CompactToolMessage,
} from '@/agent/microcompact';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function assistant(
  ts: number,
  toolCalls: { id: string; name: string }[] = [],
  content = '',
  messageId?: string,
): CompactAssistantMessage {
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(messageId !== undefined ? { messageId } : {}),
    timestamp: ts,
  };
}

function toolResult(
  toolCallId: string,
  toolName: string,
  content: string,
  ts: number,
): CompactToolMessage {
  return {
    role: 'tool',
    toolCallId,
    toolName,
    content,
    timestamp: ts,
  };
}

function user(ts: number, content = 'hi'): CompactMessage {
  return { role: 'user', content, timestamp: ts };
}

function mkLogger(): {
  logger: { info: (event: string, fields: Record<string, unknown>) => void };
  entries: { event: string; fields: Record<string, unknown> }[];
} {
  const entries: { event: string; fields: Record<string, unknown> }[] = [];
  return {
    logger: {
      info: (event, fields): void => {
        entries.push({ event, fields });
      },
    },
    entries,
  };
}

describe('BUILTIN_COMPACTABLE_TOOLS', () => {
  it('contains the five Leo mapping entries', () => {
    expect([...BUILTIN_COMPACTABLE_TOOLS].sort()).toEqual([
      'append_to_note',
      'create_note',
      'edit_note',
      'read_note',
      'search_vault',
    ]);
  });
});

describe('microcompactMessages — gating', () => {
  it('returns null when there is no assistant timestamp', () => {
    const messages: CompactMessage[] = [
      user(NOW - 120 * MIN),
      { role: 'assistant', content: 'ok' },
    ];
    expect(microcompactMessages(messages, { now: NOW })).toBeNull();
  });

  it('returns null when gap < gapThresholdMinutes', () => {
    const messages: CompactMessage[] = [
      user(NOW - 10 * MIN),
      assistant(NOW - 10 * MIN, [{ id: 't1', name: 'read_note' }], 'r'),
      toolResult('t1', 'read_note', 'payload', NOW - 10 * MIN),
      assistant(NOW - 10 * MIN, [{ id: 't2', name: 'read_note' }], 'r'),
      toolResult('t2', 'read_note', 'payload', NOW - 10 * MIN),
    ];
    expect(microcompactMessages(messages, { now: NOW })).toBeNull();
  });

  it('returns null when no compactable tools used', () => {
    const messages: CompactMessage[] = [
      user(NOW - 120 * MIN),
      assistant(NOW - 120 * MIN, [{ id: 't1', name: 'TodoWrite' }], ''),
      toolResult('t1', 'TodoWrite', 'x', NOW - 120 * MIN),
    ];
    expect(microcompactMessages(messages, { now: NOW })).toBeNull();
  });

  it('returns null when all compactable tool_uses fit in keepRecent', () => {
    const messages: CompactMessage[] = [
      user(NOW - 200 * MIN),
      assistant(NOW - 200 * MIN, [{ id: 't1', name: 'read_note' }], ''),
      toolResult('t1', 'read_note', 'a', NOW - 200 * MIN),
      assistant(NOW - 200 * MIN, [{ id: 't2', name: 'read_note' }], ''),
      toolResult('t2', 'read_note', 'b', NOW - 200 * MIN),
    ];
    expect(microcompactMessages(messages, { now: NOW, keepRecent: 5 })).toBeNull();
  });
});

describe('microcompactMessages — clearing', () => {
  function matrixMessages(nPairs: number): CompactMessage[] {
    const out: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < nPairs; i += 1) {
      out.push(assistant(NOW - 200 * MIN + i, [{ id: `call-${i}`, name: 'read_note' }], ''));
      out.push(
        toolResult(`call-${i}`, 'read_note', `payload-${i}-`.padEnd(400, 'x'), NOW - 200 * MIN + i),
      );
    }
    return out;
  }

  it('fires at default 60-min gap with default keepRecent=5 clearing only the oldest', () => {
    const messages = matrixMessages(7);
    const res = microcompactMessages(messages, { now: NOW });
    expect(res).not.toBeNull();
    expect(res!.toolsCleared).toBe(2);
    expect(res!.toolsKept).toBe(5);
    expect(res!.keepRecent).toBe(DEFAULT_KEEP_RECENT);
    expect(res!.gapMinutes).toBeGreaterThanOrEqual(DEFAULT_GAP_THRESHOLD_MINUTES);
    const cleared = res!.messages.filter(
      (m): m is CompactToolMessage => m.role === 'tool' && m.content === CLEARED_CONTENT_MARKER,
    );
    expect(cleared.map((c) => c.toolCallId)).toEqual(['call-0', 'call-1']);
  });

  it('respects custom keepRecent=2', () => {
    const messages = matrixMessages(5);
    const res = microcompactMessages(messages, { now: NOW, keepRecent: 2 });
    expect(res).not.toBeNull();
    expect(res!.toolsCleared).toBe(3);
    expect(res!.toolsKept).toBe(2);
    const toolMessages = res!.messages.filter((m): m is CompactToolMessage => m.role === 'tool');
    const contents = toolMessages.map((m) => m.content);
    expect(contents.slice(0, 3)).toEqual([
      CLEARED_CONTENT_MARKER,
      CLEARED_CONTENT_MARKER,
      CLEARED_CONTENT_MARKER,
    ]);
    expect(contents[3]).toMatch(/^payload-3-/);
    expect(contents[4]).toMatch(/^payload-4-/);
  });

  it('clamps keepRecent minimum to 1', () => {
    const messages = matrixMessages(3);
    const res = microcompactMessages(messages, { now: NOW, keepRecent: 0 });
    expect(res).not.toBeNull();
    expect(res!.keepRecent).toBe(1);
    expect(res!.toolsKept).toBe(1);
    expect(res!.toolsCleared).toBe(2);
  });

  it('preserves tool_use ↔ tool_result pairing for cleared and kept rounds', () => {
    const messages = matrixMessages(7);
    const res = microcompactMessages(messages, { now: NOW });
    expect(res).not.toBeNull();
    const toolUseIds = new Set<string>();
    for (const m of res!.messages) {
      if (m.role === 'assistant' && m.toolCalls !== undefined) {
        for (const c of m.toolCalls) toolUseIds.add(c.id);
      }
    }
    const toolResultIds = res!.messages
      .filter((m): m is CompactToolMessage => m.role === 'tool')
      .map((m) => m.toolCallId);
    for (const rid of toolResultIds) {
      expect(toolUseIds.has(rid)).toBe(true);
    }
  });

  it('leaves non-compactable tool_results untouched even when firing', () => {
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 7; i += 1) {
      messages.push(
        assistant(
          NOW - 200 * MIN,
          [{ id: `c${i}`, name: i % 2 === 0 ? 'read_note' : 'TodoWrite' }],
          '',
        ),
        toolResult(
          `c${i}`,
          i % 2 === 0 ? 'read_note' : 'TodoWrite',
          `p${i}-`.padEnd(400, 'x'),
          NOW - 200 * MIN,
        ),
      );
    }
    const res = microcompactMessages(messages, { now: NOW, keepRecent: 1 });
    expect(res).not.toBeNull();
    const tool = res!.messages.filter((m): m is CompactToolMessage => m.role === 'tool');
    for (const t of tool) {
      if (t.toolName === 'TodoWrite') {
        expect(t.content).not.toBe(CLEARED_CONTENT_MARKER);
      }
    }
    const readCleared = tool.filter(
      (t) => t.toolName === 'read_note' && t.content === CLEARED_CONTENT_MARKER,
    );
    expect(readCleared.length).toBe(3);
  });

  it('supports ctx.isCompactable for MCP opt-in', () => {
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 7; i += 1) {
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'mcp.github.read_file' }], ''),
        toolResult(`c${i}`, 'mcp.github.read_file', `p${i}-`.padEnd(400, 'x'), NOW - 200 * MIN),
      );
    }
    const res = microcompactMessages(messages, {
      now: NOW,
      keepRecent: 2,
      isCompactable: (name) => name.startsWith('mcp.'),
    });
    expect(res).not.toBeNull();
    expect(res!.toolsCleared).toBe(5);
  });

  it('returns byte-identical non-tool_result messages', () => {
    const messages = matrixMessages(7);
    const res = microcompactMessages(messages, { now: NOW });
    expect(res).not.toBeNull();
    const original = messages;
    for (const orig of original) {
      if (orig.role === 'tool') continue;
      const match = res!.messages.find(
        (m) => m.role === orig.role && JSON.stringify(m) === JSON.stringify(orig),
      );
      expect(match).toBeDefined();
    }
  });
});

describe('microcompactMessages — streaming-chunk adjacency (thinking continuity)', () => {
  it('keeps message-id-grouped assistant chunks adjacent and not mid-split', () => {
    const messages: CompactMessage[] = [
      user(NOW - 200 * MIN),
      { ...assistant(NOW - 200 * MIN, [], 'thinking…', 'm-1') },
      {
        ...assistant(NOW - 200 * MIN, [{ id: 'c1', name: 'read_note' }], '', 'm-1'),
      },
      toolResult('c1', 'read_note', 'p1-'.padEnd(400, 'x'), NOW - 200 * MIN),
      { ...assistant(NOW - 200 * MIN, [], 'thinking…', 'm-2') },
      {
        ...assistant(NOW - 200 * MIN, [{ id: 'c2', name: 'read_note' }], '', 'm-2'),
      },
      toolResult('c2', 'read_note', 'p2-'.padEnd(400, 'x'), NOW - 200 * MIN),
    ];
    for (let i = 3; i < 7; i += 1) {
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
        toolResult(`c${i}`, 'read_note', `p${i}-`.padEnd(400, 'x'), NOW - 200 * MIN),
      );
    }
    const res = microcompactMessages(messages, { now: NOW, keepRecent: 4 });
    expect(res).not.toBeNull();
    const ids = res!.messages
      .filter(
        (m): m is CompactAssistantMessage => m.role === 'assistant' && m.messageId !== undefined,
      )
      .map((m) => m.messageId);
    expect(ids.filter((x) => x === 'm-1').length).toBe(2);
    expect(ids.filter((x) => x === 'm-2').length).toBe(2);
    const m1Positions: number[] = [];
    const m2Positions: number[] = [];
    res!.messages.forEach((m, i) => {
      if (m.role === 'assistant' && m.messageId === 'm-1') m1Positions.push(i);
      if (m.role === 'assistant' && m.messageId === 'm-2') m2Positions.push(i);
    });
    expect(m1Positions.length).toBe(2);
    expect(m2Positions.length).toBe(2);
    expect(m1Positions[1]! - m1Positions[0]!).toBe(1);
    expect(m2Positions[1]! - m2Positions[0]!).toBe(1);
  });
});

describe('microcompactMessages — boundary marker', () => {
  it('inserts a SystemMicrocompactBoundaryMessage at the first cleared tool_result position', () => {
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 7; i += 1) {
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
        toolResult(`c${i}`, 'read_note', `payload-${i}-`.padEnd(400, 'x'), NOW - 200 * MIN),
      );
    }
    const res = microcompactMessages(messages, { now: NOW, keepRecent: 5 });
    expect(res).not.toBeNull();
    const boundaryIdx = res!.messages.findIndex(isMicrocompactBoundary);
    expect(boundaryIdx).toBeGreaterThan(0);
    const firstCleared = res!.messages.findIndex(
      (m) => m.role === 'tool' && m.content === CLEARED_CONTENT_MARKER,
    );
    expect(firstCleared).toBe(boundaryIdx + 1);
    expect(res!.boundaryMarker.kind).toBe('microcompact_boundary');
  });

  it('createMicrocompactBoundary produces a detectable message', () => {
    const b = createMicrocompactBoundary(NOW);
    expect(isMicrocompactBoundary(b)).toBe(true);
    expect(b.timestamp).toBe(NOW);
  });
});

describe('microcompactMessages — tokensSaved + null return', () => {
  it('returns null when tokensSaved would be zero (empty tool_result content)', () => {
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 7; i += 1) {
      const emptyContent = i < 2 ? '' : '';
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
        toolResult(`c${i}`, 'read_note', emptyContent, NOW - 200 * MIN),
      );
    }
    const stub = (): number => 10;
    const res = microcompactMessages(messages, {
      now: NOW,
      estimateTokens: stub,
    });
    expect(res).toBeNull();
  });

  it('returns positive tokensSaved when real content is cleared', () => {
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 7; i += 1) {
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
        toolResult(`c${i}`, 'read_note', 'x'.repeat(400), NOW - 200 * MIN),
      );
    }
    const res = microcompactMessages(messages, { now: NOW, keepRecent: 5 });
    expect(res).not.toBeNull();
    expect(res!.tokensSaved).toBeGreaterThan(0);
  });
});

describe('microcompactMessages — logger event', () => {
  it('emits microcompact.cleared with required fields', () => {
    const { logger, entries } = mkLogger();
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 7; i += 1) {
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
        toolResult(`c${i}`, 'read_note', 'x'.repeat(400), NOW - 200 * MIN),
      );
    }
    const res = microcompactMessages(messages, { now: NOW, logger }, 'turn-loop');
    expect(res).not.toBeNull();
    const ev = entries.find((e) => e.event === 'microcompact.cleared');
    expect(ev).toBeDefined();
    expect(ev!.fields).toMatchObject({
      gapMinutes: expect.any(Number),
      toolsCleared: 2,
      toolsKept: 5,
      keepRecent: DEFAULT_KEEP_RECENT,
      tokensSaved: expect.any(Number),
      querySource: 'turn-loop',
    });
  });

  it('does not emit when pass returns null', () => {
    const { logger, entries } = mkLogger();
    const messages: CompactMessage[] = [
      user(NOW - 5 * MIN),
      assistant(NOW - 5 * MIN, [{ id: 'a', name: 'read_note' }], ''),
      toolResult('a', 'read_note', 'p', NOW - 5 * MIN),
    ];
    microcompactMessages(messages, { now: NOW, logger });
    expect(entries).toEqual([]);
  });
});

describe('microcompactMessages — no-LLM + purity', () => {
  it('never invokes fetch / network APIs', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('microcompact must not call fetch');
    }) as typeof fetch);
    try {
      const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
      for (let i = 0; i < 7; i += 1) {
        messages.push(
          assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
          toolResult(`c${i}`, 'read_note', 'x'.repeat(200), NOW - 200 * MIN),
        );
      }
      microcompactMessages(messages, { now: NOW });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('is pure: two identical calls return equal structure', () => {
    const messages: CompactMessage[] = [user(NOW - 200 * MIN)];
    for (let i = 0; i < 6; i += 1) {
      messages.push(
        assistant(NOW - 200 * MIN, [{ id: `c${i}`, name: 'read_note' }], ''),
        toolResult(`c${i}`, 'read_note', 'x'.repeat(100), NOW - 200 * MIN),
      );
    }
    const a = microcompactMessages(messages, { now: NOW });
    const b = microcompactMessages(messages, { now: NOW });
    expect(JSON.stringify(a!.messages)).toBe(JSON.stringify(b!.messages));
    expect(a!.tokensSaved).toBe(b!.tokensSaved);
  });
});

describe('estimateCompactTokens', () => {
  it('sums string content via rough len/4', () => {
    const msgs: CompactMessage[] = [{ role: 'user', content: 'abcdefgh' }];
    expect(estimateCompactTokens(msgs)).toBe(2);
  });
  it('sums tool_use assistant blocks via name+args json', () => {
    const msgs: CompactMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'x', name: 'read_note', input: { path: 'foo' } }],
      },
    ];
    expect(estimateCompactTokens(msgs)).toBeGreaterThan(0);
  });
});
