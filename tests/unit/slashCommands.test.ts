import { describe, expect, it, vi } from 'vitest';
import { createSlashRegistry, parseSlashInput } from '@/ui/chat/slashCommands';
import type { Logger } from '@/platform/Logger';

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('parseSlashInput', () => {
  it('returns null for text without a leading slash', () => {
    expect(parseSlashInput('hello')).toBeNull();
    expect(parseSlashInput('')).toBeNull();
  });

  it('returns null for a bare slash', () => {
    expect(parseSlashInput('/')).toBeNull();
    expect(parseSlashInput('/   ')).toBeNull();
  });

  it('parses a no-arg command', () => {
    expect(parseSlashInput('/clear')).toEqual({
      raw: '/clear',
      name: 'clear',
      args: '',
    });
  });

  it('lower-cases the command name', () => {
    expect(parseSlashInput('/Clear')?.name).toBe('clear');
    expect(parseSlashInput('/PLAN')?.name).toBe('plan');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseSlashInput('  /clear  ')).toEqual({
      raw: '  /clear  ',
      name: 'clear',
      args: '',
    });
  });

  it('captures arguments after the command name', () => {
    expect(parseSlashInput('/plan start now')).toEqual({
      raw: '/plan start now',
      name: 'plan',
      args: 'start now',
    });
  });

  it('accepts hyphen/underscore/digit in command names', () => {
    expect(parseSlashInput('/foo-bar_2')?.name).toBe('foo-bar_2');
  });

  it('rejects command names starting with digits', () => {
    expect(parseSlashInput('/2fast')).toBeNull();
  });
});

describe('createSlashRegistry', () => {
  it('returns false for text that is not a slash command', () => {
    const r = createSlashRegistry();
    r.register({ name: 'clear', description: 'clear chat', run: vi.fn() });
    expect(r.tryHandle('hello')).toBe(false);
  });

  it('returns false for an unknown slash command', () => {
    const r = createSlashRegistry();
    r.register({ name: 'clear', description: 'clear chat', run: vi.fn() });
    expect(r.tryHandle('/nope')).toBe(false);
  });

  it('runs a matching no-arg command and returns true', async () => {
    const run = vi.fn();
    const r = createSlashRegistry();
    r.register({ name: 'clear', description: 'clear chat', run });
    expect(r.tryHandle('/clear')).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('default match rejects commands given arguments', () => {
    const run = vi.fn();
    const r = createSlashRegistry();
    r.register({ name: 'clear', description: 'clear chat', run });
    expect(r.tryHandle('/clear extra')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('custom match lets a command accept arguments', async () => {
    const run = vi.fn();
    const r = createSlashRegistry();
    r.register({
      name: 'greet',
      description: 'greet someone',
      match: (ctx) => ctx.name === 'greet',
      run,
    });
    expect(r.tryHandle('/greet world')).toBe(true);
    await flush();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ name: 'greet', args: 'world' }));
  });

  it('list returns registered commands alphabetically', () => {
    const r = createSlashRegistry();
    r.register({ name: 'plan', description: 'enter plan', run: vi.fn() });
    r.register({ name: 'clear', description: 'clear chat', run: vi.fn() });
    r.register({ name: 'context', description: 'show context', run: vi.fn() });
    expect(r.list().map((c) => c.name)).toEqual(['clear', 'context', 'plan']);
  });

  it('throws on duplicate registration', () => {
    const r = createSlashRegistry();
    r.register({ name: 'clear', description: 'clear chat', run: vi.fn() });
    expect(() => r.register({ name: 'clear', description: 'dup', run: vi.fn() })).toThrow(
      /already registered/,
    );
  });

  it('routes async rejections to logger.warn and onError', async () => {
    const warn = vi.fn();
    const onError = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    } as unknown as Logger;
    const r = createSlashRegistry({ logger, onError });
    r.register({
      name: 'boom',
      description: 'boom',
      run: async () => {
        throw new Error('nope');
      },
    });
    expect(r.tryHandle('/boom')).toBe(true);
    await flush();
    await flush();
    expect(warn).toHaveBeenCalledWith(
      'slash.run.failed',
      expect.objectContaining({ name: 'boom', error: 'nope' }),
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
