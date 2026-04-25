import type { ChatMessageRecord, ContentBlock } from './types';

export class ChatMessageStore {
  private messages: readonly ChatMessageRecord[] = [];
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): readonly ChatMessageRecord[] => this.messages;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: readonly ChatMessageRecord[]): void {
    this.messages = next;
    this.notify();
  }

  append(record: ChatMessageRecord): void {
    this.messages = [...this.messages, record];
    this.notify();
  }

  clear(): void {
    if (this.messages.length === 0) return;
    this.messages = [];
    this.notify();
  }

  update(id: string, patch: (prev: ChatMessageRecord) => ChatMessageRecord): void {
    let changed = false;
    const next = this.messages.map((m) => {
      if (m.id !== id) return m;
      const after = patch(m);
      if (after === m) return m;
      changed = true;
      return after;
    });
    if (!changed) return;
    this.messages = next;
    this.notify();
  }

  appendBlock(id: string, block: ContentBlock): void {
    this.update(id, (prev) => {
      const blocks = prev.blocks ?? [];
      return { ...prev, blocks: [...blocks, block] };
    });
  }

  updateBlock<B extends ContentBlock>(
    id: string,
    index: number,
    patch: B | ((prev: ContentBlock | undefined) => ContentBlock),
  ): void {
    this.update(id, (prev) => {
      const blocks = prev.blocks ?? [];
      const existing = blocks[index];
      const next = typeof patch === 'function' ? patch(existing) : patch;
      if (existing === next) return prev;
      const nextBlocks = blocks.slice();
      while (nextBlocks.length <= index) {
        nextBlocks.push({ type: 'text', text: '' });
      }
      nextBlocks[index] = next;
      return { ...prev, blocks: nextBlocks };
    });
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
