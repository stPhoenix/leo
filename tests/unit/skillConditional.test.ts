import { describe, expect, it } from 'vitest';
import { createConditionalMatcher } from '@/skills/conditional';

describe('conditional matcher', () => {
  it('returns null for empty or match-all patterns', () => {
    expect(createConditionalMatcher([])).toBeNull();
    expect(createConditionalMatcher(['**'])).toBeNull();
  });

  it('activates on matching paths', () => {
    const matcher = createConditionalMatcher(['src/**/*.ts']);
    expect(matcher!.matches('src/agent/types.ts')).toBe(true);
    expect(matcher!.matches('tests/agent/types.ts')).toBe(false);
  });

  it('rejects ..-prefixed paths', () => {
    const matcher = createConditionalMatcher(['**/*.ts']);
    expect(matcher!.matches('../out.ts')).toBe(false);
  });
});
