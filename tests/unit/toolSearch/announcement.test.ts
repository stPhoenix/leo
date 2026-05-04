import { describe, it, expect } from 'vitest';
import { formatDeferredAnnouncement } from '@/tools/toolSearch/announcement';

describe('toolSearch.announcement', () => {
  it('returns null when both empty', () => {
    expect(formatDeferredAnnouncement(new Set(), new Set())).toBeNull();
  });

  it('returns null when set unchanged', () => {
    const a = new Set(['x', 'y']);
    const b = new Set(['y', 'x']);
    expect(formatDeferredAnnouncement(a, b)).toBeNull();
  });

  it('lists deferred names sorted', () => {
    const text = formatDeferredAnnouncement(new Set(['mcp.b', 'mcp.a']), new Set());
    expect(text).toContain('mcp.a');
    expect(text).toContain('mcp.b');
    expect(text!.indexOf('mcp.a')).toBeLessThan(text!.indexOf('mcp.b'));
  });

  it('emits empty-pool reminder when set drained', () => {
    const text = formatDeferredAnnouncement(new Set(), new Set(['x']));
    expect(text).toMatch(/empty/);
  });
});
