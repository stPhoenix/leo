import { describe, expect, it } from 'vitest';
import { chunkIteration } from '@/indexer/chunkIteration';

describe('chunkIteration', () => {
  it('returns all paths in now when deadline has plenty of budget', () => {
    const deadline = { timeRemaining: () => 50 };
    const { now, rest } = chunkIteration(['a', 'b', 'c'], deadline, 5);
    expect(now).toEqual(['a', 'b', 'c']);
    expect(rest).toEqual([]);
  });

  it('stops when timeRemaining drops below minBudgetMs', () => {
    let remaining = 20;
    const deadline = {
      timeRemaining: (): number => {
        const v = remaining;
        remaining -= 10;
        return v;
      },
    };
    const { now, rest } = chunkIteration(['a', 'b', 'c', 'd', 'e'], deadline, 5);
    expect(now.length).toBeLessThan(5);
    expect([...now, ...rest]).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('always advances by at least one path even when starting budget is below threshold', () => {
    const deadline = { timeRemaining: () => 1 };
    const { now, rest } = chunkIteration(['a', 'b'], deadline, 5);
    expect(now).toEqual(['a']);
    expect(rest).toEqual(['b']);
  });

  it('returns empty now when input is empty regardless of budget', () => {
    const deadline = { timeRemaining: () => 1 };
    const { now, rest } = chunkIteration([], deadline, 5);
    expect(now).toEqual([]);
    expect(rest).toEqual([]);
  });

  it('handles empty input', () => {
    const deadline = { timeRemaining: () => 50 };
    const { now, rest } = chunkIteration([], deadline, 5);
    expect(now).toEqual([]);
    expect(rest).toEqual([]);
  });
});
