import { describe, expect, it } from 'vitest';
import { containsShellExpression, evaluateShellInBody } from '@/skills/shellExec';

describe('containsShellExpression', () => {
  it('detects inline and fenced markers', () => {
    expect(containsShellExpression('plain body')).toBe(false);
    expect(containsShellExpression('before !`2 + 2` after')).toBe(true);
    expect(containsShellExpression('```!\nreturn 1;\n```')).toBe(true);
  });
});

describe('evaluateShellInBody', () => {
  it('evaluates inline JS expressions and coerces to string', async () => {
    const out = await evaluateShellInBody({
      body: 'sum is !`1 + 2 + 3`, name is !`"leo"`',
      ctx: { args: '' },
    });
    expect(out).toBe('sum is 6, name is leo');
  });

  it('evaluates fenced async blocks and uses ctx.args', async () => {
    const out = await evaluateShellInBody({
      body: 'hi ```!\nconst parts = ctx.args.split(" ");\nreturn parts.join("-");\n```',
      ctx: { args: 'one two three' },
    });
    expect(out).toBe('hi one-two-three');
  });

  it('swallows runtime errors into an inline marker', async () => {
    const out = await evaluateShellInBody({
      body: '!`(() => { throw new Error("boom"); })()`',
      ctx: { args: '' },
    });
    expect(out).toContain('[skill shell error: boom]');
  });

  it('honours timeoutMs from shell spec', async () => {
    const start = Date.now();
    const out = await evaluateShellInBody({
      body: '!`await new Promise(() => {})`',
      ctx: { args: '' },
      spec: { timeoutMs: 40 },
    });
    expect(out).toContain('timed out');
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('exposes skillDir, sessionId, threadId on ctx', async () => {
    const out = await evaluateShellInBody({
      body: '!`ctx.skillDir + "|" + ctx.sessionId + "|" + ctx.threadId`',
      ctx: { args: '', skillDir: 'dir', sessionId: 's1', threadId: 't1' },
    });
    expect(out).toBe('dir|s1|t1');
  });
});
