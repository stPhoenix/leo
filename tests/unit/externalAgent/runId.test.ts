import { describe, expect, it } from 'vitest';
import { generateRunId } from '@/agent/externalAgent/runId';

describe('generateRunId', () => {
  it('formats as YYYYMMDD-HHmmss-<6char>', () => {
    const id = generateRunId({
      now: () => new Date(2026, 3, 27, 14, 15, 3),
      tail: () => 'a1b2c3',
    });
    expect(id).toBe('20260427-141503-a1b2c3');
  });

  it('zero-pads month, day, hour, minute, second', () => {
    const id = generateRunId({
      now: () => new Date(2026, 0, 1, 0, 0, 9),
      tail: () => 'aaaaaa',
    });
    expect(id).toBe('20260101-000009-aaaaaa');
  });

  it('produces unique tails on default call', () => {
    const a = generateRunId();
    const b = generateRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\d{8}-\d{6}-[a-z0-9]{6}$/i);
  });
});
