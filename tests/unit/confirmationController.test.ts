import { describe, expect, it, vi } from 'vitest';
import {
  ConfirmationController,
  prettifyArgs,
  type ToolConfirmationRequest,
} from '@/agent/confirmationController';

function makeRequest(toolId = 'write_note'): ToolConfirmationRequest {
  return {
    toolId,
    thread: 'default',
    argsJson: '{"path":"a.md","content":"body"}',
    argsPretty: '{\n  "path": "a.md"\n}',
    category: toolId.startsWith('read_') ? 'read' : 'write',
  };
}

describe('ConfirmationController', () => {
  it('request surfaces the pending entry and subscribers are notified', () => {
    const c = new ConfirmationController();
    const seen: Array<string | null> = [];
    c.subscribe((p) => seen.push(p?.request.toolId ?? null));
    const p1 = c.request(makeRequest('write_note'));
    expect(c.current()?.request.toolId).toBe('write_note');
    expect(seen).toEqual(['write_note']);
    c.resolve('allow-once');
    expect(c.current()).toBeNull();
    return expect(p1).resolves.toBe('allow-once');
  });

  it('resolve routes allow-thread to the pending promise and clears the current slot', async () => {
    const c = new ConfirmationController();
    const p = c.request(makeRequest());
    c.resolve('allow-thread');
    await expect(p).resolves.toBe('allow-thread');
    expect(c.current()).toBeNull();
  });

  it('resolve with deny yields deny', async () => {
    const c = new ConfirmationController();
    const p = c.request(makeRequest());
    c.resolve('deny');
    await expect(p).resolves.toBe('deny');
  });

  it('a second request while one is pending denies the first and replaces it', async () => {
    const c = new ConfirmationController();
    const first = c.request(makeRequest('first_tool'));
    const second = c.request(makeRequest('second_tool'));
    expect(c.current()?.request.toolId).toBe('second_tool');
    c.resolve('allow-once');
    await expect(first).resolves.toBe('deny');
    await expect(second).resolves.toBe('allow-once');
  });

  it('dispose denies any pending request', async () => {
    const c = new ConfirmationController();
    const p = c.request(makeRequest());
    c.dispose();
    await expect(p).resolves.toBe('deny');
    expect(c.current()).toBeNull();
  });

  it('unsubscribe removes listeners', () => {
    const c = new ConfirmationController();
    const cb = vi.fn();
    const off = c.subscribe(cb);
    off();
    void c.request(makeRequest());
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('prettifyArgs', () => {
  it('pretty-prints valid JSON with 2-space indent', () => {
    expect(prettifyArgs('{"x":1}')).toBe('{\n  "x": 1\n}');
  });
  it('returns raw args when JSON is invalid', () => {
    expect(prettifyArgs('{bad')).toBe('{bad');
  });
  it('caps large payloads with a truncation marker', () => {
    const big = JSON.stringify({ x: 'y'.repeat(5_000) });
    const out = prettifyArgs(big);
    expect(out.length).toBeLessThan(big.length + 50);
    expect(out).toContain('(truncated,');
  });
});
