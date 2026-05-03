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

  it('forbids vault, web, and recursion', () => {
    const p = getRefineSystemPrompt();
    expect(p).toMatch(/vault/i);
    expect(p).toMatch(/web/i);
    expect(p).toMatch(/recurs/i);
  });

  it('instructs inlining content rather than referencing vault paths', () => {
    expect(getRefineSystemPrompt()).toMatch(/inline/i);
  });

  it('declares the external agent is opaque', () => {
    expect(getRefineSystemPrompt()).toMatch(/opaque/i);
  });

  it('demands goal + acceptance criteria framing', () => {
    const p = getRefineSystemPrompt();
    expect(p).toMatch(/GOAL/i);
    expect(p).toMatch(/acceptance criteria/i);
  });

  it('forbids prescribing concrete methods/tools/paths', () => {
    expect(getRefineSystemPrompt()).toMatch(/method|tools|CLIs|shell|storage paths/i);
  });

  it('stays under 2500 chars', () => {
    expect(getRefineSystemPrompt().length).toBeLessThan(2500);
  });
});
