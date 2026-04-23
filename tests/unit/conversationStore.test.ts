import { describe, expect, it, vi } from 'vitest';
import { ConversationStore } from '@/storage/conversationStore';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  failRenameOnce = false;
  failWriteOnce = false;
  renameSpy = vi.fn<[string, string], Promise<void>>();
  writeSpy = vi.fn<[string, string], Promise<void>>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
  async mkdir(_path: string): Promise<void> {
    /* no-op */
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }
  async write(path: string, data: string): Promise<void> {
    await this.writeSpy(path, data);
    if (this.failWriteOnce) {
      this.failWriteOnce = false;
      throw new Error('write failed');
    }
    this.files.set(path, data);
  }
  async rename(from: string, to: string): Promise<void> {
    await this.renameSpy(from, to);
    if (this.failRenameOnce) {
      this.failRenameOnce = false;
      throw new Error('rename failed');
    }
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`ENOENT ${from}`);
    this.files.delete(from);
    this.files.set(to, v);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async list(_path: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
}

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {
      /* no-op */
    },
  };
  return {
    logger: new Logger({
      level: 'debug',
      sink,
      consoleImpl: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    }),
    records,
  };
}

describe('ConversationStore', () => {
  it('load on missing file returns an empty thread with schemaVersion 1 and does not error', async () => {
    const adapter = new FakeVault();
    const { logger, records } = makeLogger();
    const store = new ConversationStore({ adapter, logger });
    const thread = await store.load();
    expect(thread.messages).toEqual([]);
    expect(thread.schemaVersion).toBe(1);
    expect(thread.metadata).toEqual({ allowedTools: [] });
    expect(records.find((r) => r.event === 'conversation.load')).toBeDefined();
  });

  it('debounces burst mutations into a single atomic write (tmp + rename)', async () => {
    const adapter = new FakeVault();
    const { logger } = makeLogger();
    const store = new ConversationStore({ adapter, logger, debounceMs: 50 });
    await store.load();
    for (let i = 0; i < 5; i += 1) {
      store.mutate((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { id: `u${i}`, role: 'user', content: `m${i}`, createdAt: '2026-04-21T00:00:00.000Z' },
        ],
      }));
    }
    await new Promise((r) => setTimeout(r, 80));
    expect(adapter.writeSpy).toHaveBeenCalledTimes(1);
    expect(adapter.writeSpy.mock.calls[0]![0]).toBe('.leo/conversations/default.json.tmp');
    expect(adapter.renameSpy).toHaveBeenCalledWith(
      '.leo/conversations/default.json.tmp',
      '.leo/conversations/default.json',
    );
    expect(adapter.files.has('.leo/conversations/default.json')).toBe(true);
  });

  it('flush bypasses the debounce and writes immediately', async () => {
    const adapter = new FakeVault();
    const { logger } = makeLogger();
    const store = new ConversationStore({ adapter, logger, debounceMs: 5_000 });
    await store.load();
    store.mutate((prev) => ({
      ...prev,
      metadata: { allowedTools: ['read_note'] },
    }));
    await store.flush();
    expect(adapter.files.has('.leo/conversations/default.json')).toBe(true);
    const written = adapter.files.get('.leo/conversations/default.json')!;
    expect(written).toContain('read_note');
  });

  it('round-trips messages across save + load', async () => {
    const adapter = new FakeVault();
    const { logger } = makeLogger();
    const a = new ConversationStore({ adapter, logger, debounceMs: 5 });
    await a.load();
    a.mutate((prev) => ({
      ...prev,
      messages: [
        { id: 'u1', role: 'user', content: 'hi', createdAt: 't0' },
        {
          id: 'a1',
          role: 'assistant',
          content: 'hello',
          createdAt: 't1',
          status: 'done',
          tokens: { input: 1, output: 1, total: 2, source: 'api' },
        },
      ],
      metadata: { allowedTools: ['search_vault'] },
    }));
    await a.flush();

    const b = new ConversationStore({ adapter, logger });
    const loaded = await b.load();
    expect(loaded.messages.length).toBe(2);
    expect(loaded.messages[1]?.tokens).toEqual({ input: 1, output: 1, total: 2, source: 'api' });
    expect(loaded.metadata).toEqual({ allowedTools: ['search_vault'] });
  });

  it('cleans up the .tmp file on rename failure', async () => {
    const adapter = new FakeVault();
    const { logger } = makeLogger();
    adapter.failRenameOnce = true;
    const store = new ConversationStore({ adapter, logger });
    await store.load();
    store.mutate((prev) => ({
      ...prev,
      messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: 't' }],
    }));
    await expect(store.flush()).rejects.toThrow();
    expect(adapter.files.has('.leo/conversations/default.json.tmp')).toBe(false);
  });
});
