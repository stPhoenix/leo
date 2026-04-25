import { describe, expect, it } from 'vitest';
import { computeUnifiedDiff } from '@/chat/diff';

describe('computeUnifiedDiff (F12 AC1)', () => {
  it('identical inputs return zero changes', () => {
    const r = computeUnifiedDiff('a\nb\nc', 'a\nb\nc');
    expect(r.stats.added).toBe(0);
    expect(r.stats.removed).toBe(0);
  });

  it('one-line addition', () => {
    const r = computeUnifiedDiff('a\nb', 'a\nb\nc');
    expect(r.stats.added).toBe(1);
    expect(r.stats.removed).toBe(0);
    const last = r.lines[r.lines.length - 1]!;
    expect(last.kind).toBe('add');
    expect(last.text).toBe('c');
  });

  it('one-line deletion', () => {
    const r = computeUnifiedDiff('a\nb\nc', 'a\nc');
    expect(r.stats.added).toBe(0);
    expect(r.stats.removed).toBe(1);
  });

  it('mixed hunk: replace one line', () => {
    const r = computeUnifiedDiff('a\nb\nc', 'a\nB\nc');
    expect(r.stats.added).toBe(1);
    expect(r.stats.removed).toBe(1);
  });

  it('pure addition (create from empty)', () => {
    const r = computeUnifiedDiff('', 'x\ny\nz');
    expect(r.stats.added).toBe(3);
    expect(r.stats.removed).toBe(0);
  });

  it('context trimmed when far from change', () => {
    const before = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
    const after = before + '\nNEW';
    const r = computeUnifiedDiff(before, after, { context: 2 });
    // The context window around the addition is ≤ 2*ctx + 1 = 5 lines.
    expect(r.lines.length).toBeLessThanOrEqual(6);
  });
});
