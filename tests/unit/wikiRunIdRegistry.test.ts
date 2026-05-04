import { describe, expect, it } from 'vitest';
import { generateWikiRunId } from '@/agent/wiki/runIdRegistry';

describe('generateWikiRunId', () => {
  it('formats YYYYMMDD-HHmmss-<6char> deterministically given now/tail', () => {
    const id = generateWikiRunId({
      now: () => new Date('2026-04-29T02:30:45Z'),
      tail: () => 'abc123',
    });
    // Time formatted in local TZ, but the YYYYMMDD- and trailing -abc123 anchors are stable.
    expect(id.length).toBe(22);
    expect(/^\d{8}-\d{6}-abc123$/.test(id)).toBe(true);
  });

  it('two calls with the same fixed time + tail produce identical ids', () => {
    const opts = {
      now: () => new Date('2026-04-29T02:30:45Z'),
      tail: () => 'xyzqrs',
    };
    expect(generateWikiRunId(opts)).toBe(generateWikiRunId(opts));
  });

  it('default tail is 6 chars + alphanumeric', () => {
    const id = generateWikiRunId({ now: () => new Date('2026-01-01T00:00:00Z') });
    const tail = id.slice(-6);
    expect(tail.length).toBe(6);
    expect(/^[a-z0-9]{6}$/.test(tail)).toBe(true);
  });
});
