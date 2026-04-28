import { describe, expect, it } from 'vitest';
import { applySubstitutions } from '@/skills/substitutions';

describe('applySubstitutions', () => {
  it('substitutes positional args, named args, and $ARGUMENTS', () => {
    const out = applySubstitutions({
      body: 'hi $1 and $name — all: $ARGUMENTS',
      args: 'alice "bob carol"',
      argNames: ['name'],
      ctx: {},
    });
    expect(out).toContain('hi alice and alice');
    expect(out).toContain('all: alice "bob carol"');
  });

  it('prepends base directory and normalises Windows backslashes in ${CLAUDE_SKILL_DIR}', () => {
    const out = applySubstitutions({
      body: 'dir is ${CLAUDE_SKILL_DIR}/asset.json',
      args: '',
      baseDir: 'vault\\skills\\x',
      ctx: {},
    });
    expect(out.startsWith('Base directory for this skill: vault\\skills\\x')).toBe(true);
    expect(out).toContain('vault/skills/x/asset.json');
  });

  it('leaves unknown named placeholders untouched', () => {
    const out = applySubstitutions({ body: 'hi $nope', args: '', ctx: {} });
    expect(out).toContain('$nope');
  });

  it('substitutes ${CLAUDE_SESSION_ID} when provided', () => {
    const out = applySubstitutions({
      body: 'session is ${CLAUDE_SESSION_ID}',
      args: '',
      ctx: { sessionId: 'abc123' },
    });
    expect(out).toContain('session is abc123');
  });
});
