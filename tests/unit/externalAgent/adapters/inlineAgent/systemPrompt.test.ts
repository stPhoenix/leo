import { describe, expect, it } from 'vitest';
import {
  getInlineAgentSystemPrompt,
  resolveSystemPrompt,
} from '@/agent/externalAgent/adapters/inlineAgent';
import {
  getInlineAgentResearchPrompt,
  getInlineAgentSynthesizePrompt,
} from '@/agent/externalAgent/adapters/inlineAgent/systemPrompt';

describe('inline-agent system prompt (F02)', () => {
  it('returns a non-empty deterministic prompt', () => {
    const a = getInlineAgentSystemPrompt();
    const b = getInlineAgentSystemPrompt();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(200);
  });

  it('simple prompt describes core tools, sandbox rules, and termination', () => {
    const p = getInlineAgentSystemPrompt();
    expect(p).toMatch(/fetch_url/);
    expect(p).toMatch(/search_web/);
    expect(p).toMatch(/publish_artifact/);
    expect(p).toMatch(/sandbox/i);
    expect(p).toMatch(/termination|terminate|final assistant message|final summary/i);
  });

  it('research prompt covers extract_note + stage contract', () => {
    const p = getInlineAgentResearchPrompt();
    expect(p).toMatch(/extract_note/);
    expect(p).toMatch(/research stage/i);
    expect(p).toMatch(/Forbidden: .?publish_artifact/);
  });

  it('synthesize prompt forces publish_artifact-only', () => {
    const p = getInlineAgentSynthesizePrompt();
    expect(p).toMatch(/publish_artifact/);
    expect(p).toMatch(/synthesize/i);
  });

  it('teaches the model to treat <untrusted-content> blocks as data', () => {
    const p = getInlineAgentSystemPrompt();
    expect(p).toMatch(/<untrusted-content/);
    expect(p).toMatch(/never instructions/i);
  });

  it('resolveSystemPrompt prepends host prompt ahead of inline (AC4)', () => {
    const inline = getInlineAgentSystemPrompt();
    const out = resolveSystemPrompt({ hostPrompt: 'HOST', override: null });
    expect(out.startsWith('HOST')).toBe(true);
    expect(out.endsWith(inline)).toBe(true);
  });

  it('resolveSystemPrompt uses override when non-null (AC4)', () => {
    const out = resolveSystemPrompt({ hostPrompt: 'HOST', override: 'CUSTOM' });
    expect(out).toBe('HOST\n\nCUSTOM');
  });

  it('resolveSystemPrompt with empty host prompt returns inline only', () => {
    const out = resolveSystemPrompt({ hostPrompt: '', override: null });
    expect(out).toBe(getInlineAgentSystemPrompt());
  });
});
