import { describe, expect, it } from 'vitest';
import { getRefineSystemPrompt } from '@/agent/externalAgent/refinePrompt';

describe('getRefineSystemPrompt', () => {
  it('is pure (same output across calls)', () => {
    expect(getRefineSystemPrompt()).toBe(getRefineSystemPrompt());
  });

  it('mentions both allowed tool names', () => {
    const p = getRefineSystemPrompt();
    expect(p).toContain('ask_clarifying_question');
    expect(p).toContain('emit_final_prompt');
  });

  it('forbids vault, web, and recursive delegate_external', () => {
    const p = getRefineSystemPrompt();
    expect(p).toContain('vault');
    expect(p).toContain('web');
    expect(p).toContain('delegate_external');
  });

  it('instructs inlining content rather than referencing vault paths', () => {
    expect(getRefineSystemPrompt()).toContain('inline');
  });
});
