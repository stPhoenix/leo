import { describe, expect, it, vi } from 'vitest';
import { ChatMessageStore } from '@/chat/messageStore';

function rec(id: string) {
  return { id, role: 'user' as const, content: `m-${id}`, createdAt: '2026-04-21' };
}

describe('ChatMessageStore', () => {
  it('starts empty and snapshots an empty array', () => {
    const store = new ChatMessageStore();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('append adds messages in order and notifies subscribers', () => {
    const store = new ChatMessageStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.append(rec('1'));
    store.append(rec('2'));
    expect(store.getSnapshot().map((m) => m.id)).toEqual(['1', '2']);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('set replaces the message list and notifies once', () => {
    const store = new ChatMessageStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.set([rec('a'), rec('b')]);
    expect(store.getSnapshot().map((m) => m.id)).toEqual(['a', 'b']);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clear is a no-op when already empty', () => {
    const store = new ChatMessageStore();
    const cb = vi.fn();
    store.subscribe(cb);
    store.clear();
    expect(cb).not.toHaveBeenCalled();
  });

  it('returned dispose stops notifications', () => {
    const store = new ChatMessageStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    off();
    store.append(rec('1'));
    expect(cb).not.toHaveBeenCalled();
  });
});
