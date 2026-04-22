import type { Logger } from '@/platform/Logger';
import { debounce, type DebouncedFn } from '@/util/debounce';
import type { VaultAdapter } from './vaultAdapter';
import {
  CONVERSATION_SCHEMA_VERSION,
  emptyThread,
  parseThread,
  serializeThread,
  type StoredThread,
} from './conversationSchema';

export const DEFAULT_THREAD_ID = 'default';
const CONVERSATIONS_DIR = '.leo/conversations';
const TMP_SUFFIX = '.tmp';

export interface ConversationStoreOptions {
  readonly adapter: VaultAdapter;
  readonly logger: Logger;
  readonly threadId?: string;
  readonly debounceMs?: number;
  readonly clock?: () => Date;
  readonly baseDir?: string;
}

export interface ConversationMutation {
  (thread: StoredThread): StoredThread;
}

export class ConversationStore {
  private readonly adapter: VaultAdapter;
  private readonly logger: Logger;
  private readonly threadId: string;
  private readonly clock: () => Date;
  private readonly baseDir: string;
  private readonly debouncedSave: DebouncedFn<[]>;
  private thread: StoredThread;
  private loaded = false;

  constructor(opts: ConversationStoreOptions) {
    this.adapter = opts.adapter;
    this.logger = opts.logger;
    this.threadId = opts.threadId ?? DEFAULT_THREAD_ID;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.baseDir = opts.baseDir ?? CONVERSATIONS_DIR;
    this.thread = emptyThread(this.threadId, this.clock().toISOString());
    this.debouncedSave = debounce(() => {
      void this.saveNow();
    }, opts.debounceMs ?? 250);
  }

  getThread(): StoredThread {
    return this.thread;
  }

  async load(): Promise<StoredThread> {
    await this.adapter.mkdir(this.baseDir);
    const path = this.path();
    if (!(await this.adapter.exists(path))) {
      this.thread = emptyThread(this.threadId, this.clock().toISOString());
      this.loaded = true;
      this.logger.info('conversation.load', { path, created: true, messages: 0 });
      return this.thread;
    }
    try {
      const raw = await this.adapter.read(path);
      const json: unknown = JSON.parse(raw);
      this.thread = parseThread(json, { logger: this.logger, path });
      this.loaded = true;
      this.logger.info('conversation.load', {
        path,
        created: false,
        messages: this.thread.messages.length,
        schemaVersion: this.thread.schemaVersion,
      });
      return this.thread;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('conversation.load', { path, error: error.message });
      this.thread = emptyThread(this.threadId, this.clock().toISOString());
      this.loaded = true;
      return this.thread;
    }
  }

  mutate(fn: ConversationMutation): void {
    const next = fn(this.thread);
    this.thread = {
      ...next,
      updatedAt: this.clock().toISOString(),
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
    };
    this.debouncedSave();
  }

  scheduleSave(): void {
    this.debouncedSave();
  }

  async flush(): Promise<void> {
    this.debouncedSave.cancel();
    await this.saveNow();
  }

  dispose(): void {
    this.debouncedSave.cancel();
  }

  private path(): string {
    return `${this.baseDir}/${this.threadId}.json`;
  }

  private async saveNow(): Promise<void> {
    if (!this.loaded) return;
    const path = this.path();
    const tmp = `${path}${TMP_SUFFIX}`;
    const payload = serializeThread(this.thread);
    let wroteTmp = false;
    try {
      await this.adapter.mkdir(this.baseDir);
      await this.adapter.write(tmp, payload);
      wroteTmp = true;
      if (await this.adapter.exists(path)) {
        await this.adapter.remove(path);
      }
      await this.adapter.rename(tmp, path);
      wroteTmp = false;
      this.logger.info('conversation.save', {
        path,
        messages: this.thread.messages.length,
        bytes: payload.length,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error('conversation.save', {
        path,
        error: error.message,
      });
      if (wroteTmp) {
        try {
          await this.adapter.remove(tmp);
        } catch {
          /* best effort; already failing */
        }
      }
      throw error;
    }
  }
}
