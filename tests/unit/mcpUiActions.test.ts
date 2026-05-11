import { describe, expect, it, vi } from 'vitest';
import { parseMcpUiAction, routeMcpUiAction, type McpUiActionDeps } from '@/mcp/mcpUiActions';
import { ConfirmationController } from '@/agent/confirmationController';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { MCPClient } from '@/mcp/mcpClient';
import type { ToolCtx } from '@/tools/types';

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {},
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

function makeDeps(overrides: Partial<McpUiActionDeps> = {}): {
  deps: McpUiActionDeps;
  confirmation: ConfirmationController;
  records: LogRecord[];
  callToolMock: ReturnType<typeof vi.fn>;
  submitMock: ReturnType<typeof vi.fn>;
  openLinkMock: ReturnType<typeof vi.fn>;
  notifyMock: ReturnType<typeof vi.fn>;
} {
  const { logger, records } = makeLogger();
  const confirmation = new ConfirmationController();
  const callToolMock = vi.fn().mockResolvedValue({ ok: true, data: 'ok' });
  const submitMock = vi.fn();
  const openLinkMock = vi.fn();
  const notifyMock = vi.fn();
  const ctx: ToolCtx = {
    thread: 't1',
    signal: new AbortController().signal,
    vault: {} as ToolCtx['vault'],
    editor: {} as ToolCtx['editor'],
  };
  const deps: McpUiActionDeps = {
    serverId: 'srv',
    thread: 't1',
    mcpClient: { callTool: callToolMock } as unknown as MCPClient,
    confirmation,
    logger,
    signal: new AbortController().signal,
    submitPrompt: submitMock,
    openLink: openLinkMock,
    notify: notifyMock,
    buildToolCtx: () => ctx,
    ...overrides,
  };
  return { deps, confirmation, records, callToolMock, submitMock, openLinkMock, notifyMock };
}

describe('routeMcpUiAction', () => {
  it('tool: prompts confirmation, calls MCP on allow', async () => {
    const { deps, confirmation, callToolMock } = makeDeps();
    const promise = routeMcpUiAction(
      { type: 'tool', payload: { toolName: 'doIt', params: { x: 1 } } },
      deps,
    );
    await Promise.resolve();
    confirmation.resolve('allow-once');
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.data).toBe('ok');
    expect(callToolMock).toHaveBeenCalledWith('srv', 'doIt', { x: 1 }, expect.any(Object));
  });

  it('tool: returns deny error when user denies', async () => {
    const { deps, confirmation, callToolMock } = makeDeps();
    const promise = routeMcpUiAction({ type: 'tool', payload: { toolName: 'doIt' } }, deps);
    await Promise.resolve();
    confirmation.resolve('deny');
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/denied/);
    expect(callToolMock).not.toHaveBeenCalled();
  });

  it('tool: rejects missing toolName', async () => {
    const { deps } = makeDeps();
    const result = await routeMcpUiAction({ type: 'tool', payload: { toolName: '' } }, deps);
    expect(result.ok).toBe(false);
  });

  it('prompt: submits text', async () => {
    const { deps, submitMock } = makeDeps();
    const result = await routeMcpUiAction({ type: 'prompt', payload: { prompt: 'hello' } }, deps);
    expect(result.ok).toBe(true);
    expect(submitMock).toHaveBeenCalledWith('hello');
  });

  it('link: opens https url', async () => {
    const { deps, openLinkMock } = makeDeps();
    const result = await routeMcpUiAction(
      { type: 'link', payload: { url: 'https://example.com/a' } },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(openLinkMock).toHaveBeenCalledWith('https://example.com/a');
  });

  it('link: rejects javascript: scheme', async () => {
    const { deps, openLinkMock } = makeDeps();
    const result = await routeMcpUiAction(
      { type: 'link', payload: { url: 'javascript:alert(1)' } },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(openLinkMock).not.toHaveBeenCalled();
  });

  it('link: rejects file: scheme', async () => {
    const { deps } = makeDeps();
    const result = await routeMcpUiAction(
      { type: 'link', payload: { url: 'file:///etc/passwd' } },
      deps,
    );
    expect(result.ok).toBe(false);
  });

  it('link: rejects malformed URL', async () => {
    const { deps } = makeDeps();
    const result = await routeMcpUiAction(
      { type: 'link', payload: { url: 'not a url at all' } },
      deps,
    );
    expect(result.ok).toBe(false);
  });

  it('notify: invokes notify', async () => {
    const { deps, notifyMock } = makeDeps();
    const result = await routeMcpUiAction({ type: 'notify', payload: { message: 'toast' } }, deps);
    expect(result.ok).toBe(true);
    expect(notifyMock).toHaveBeenCalledWith('toast');
  });
});

describe('parseMcpUiAction', () => {
  it('parses valid tool action with messageId', () => {
    expect(
      parseMcpUiAction({
        type: 'tool',
        payload: { toolName: 'foo', params: { a: 1 } },
        messageId: 'm1',
      }),
    ).toEqual({
      type: 'tool',
      payload: { toolName: 'foo', params: { a: 1 } },
      messageId: 'm1',
    });
  });

  it('rejects tool without toolName', () => {
    expect(parseMcpUiAction({ type: 'tool', payload: {} })).toBeNull();
  });

  it('parses prompt action', () => {
    expect(parseMcpUiAction({ type: 'prompt', payload: { prompt: 'hi' } })).toEqual({
      type: 'prompt',
      payload: { prompt: 'hi' },
    });
  });

  it('parses link action', () => {
    expect(parseMcpUiAction({ type: 'link', payload: { url: 'https://x' } })).toEqual({
      type: 'link',
      payload: { url: 'https://x' },
    });
  });

  it('parses notify action', () => {
    expect(parseMcpUiAction({ type: 'notify', payload: { message: 'hi' } })).toEqual({
      type: 'notify',
      payload: { message: 'hi' },
    });
  });

  it('rejects unknown action types', () => {
    expect(parseMcpUiAction({ type: 'intent', payload: {} })).toBeNull();
    expect(parseMcpUiAction({ type: 'something', payload: {} })).toBeNull();
  });

  it('rejects null/non-object', () => {
    expect(parseMcpUiAction(null)).toBeNull();
    expect(parseMcpUiAction('x')).toBeNull();
  });
});
