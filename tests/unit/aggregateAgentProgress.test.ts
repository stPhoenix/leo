import { describe, expect, it } from 'vitest';
import { aggregateAgentProgress } from '@/ui/chat/blocks/AgentProgressTree';

describe('aggregateAgentProgress (F09 helper)', () => {
  it('returns empty for no agent events', () => {
    expect(aggregateAgentProgress([])).toEqual(new Map());
  });

  it('latest event wins per agentId', () => {
    const map = aggregateAgentProgress([
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Explore',
        toolUseCount: 1,
        tokens: 100,
        lastToolInfo: 'Initializing…',
      },
      {
        kind: 'agent',
        toolUseId: 't',
        agentId: 'a',
        agentType: 'Explore',
        toolUseCount: 5,
        tokens: 500,
        lastToolInfo: 'Read README',
      },
    ]);
    expect(map.get('a')?.toolUseCount).toBe(5);
    expect(map.get('a')?.lastToolInfo).toBe('Read README');
  });

  it('multiple agents preserve insertion order', () => {
    const map = aggregateAgentProgress([
      { kind: 'agent', toolUseId: 't', agentId: 'a', agentType: 'A', toolUseCount: 1 },
      { kind: 'agent', toolUseId: 't', agentId: 'b', agentType: 'B', toolUseCount: 2 },
      { kind: 'agent', toolUseId: 't', agentId: 'a', agentType: 'A', toolUseCount: 3 },
    ]);
    expect(Array.from(map.keys())).toEqual(['a', 'b']);
  });

  it('ignores non-agent kinds', () => {
    const map = aggregateAgentProgress([
      { kind: 'bash', toolUseId: 't', stdout: 'x' },
      { kind: 'agent', toolUseId: 't', agentId: 'a', agentType: 'A', toolUseCount: 1 },
    ]);
    expect(map.size).toBe(1);
  });
});
