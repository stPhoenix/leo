export interface ReadFileEntry {
  readonly content: string;
  readonly mtimeMs: number;
  readonly offset: number | undefined;
  readonly limit: number | undefined;
  readonly isPartialView: boolean;
}

export class ReadFileStateStore {
  private readonly entries = new Map<string, Map<string, ReadFileEntry>>();

  get(threadId: string, path: string): ReadFileEntry | undefined {
    return this.entries.get(threadId)?.get(path);
  }

  set(threadId: string, path: string, entry: ReadFileEntry): void {
    let perThread = this.entries.get(threadId);
    if (perThread === undefined) {
      perThread = new Map();
      this.entries.set(threadId, perThread);
    }
    perThread.set(path, entry);
  }

  invalidate(threadId: string, path: string): void {
    this.entries.get(threadId)?.delete(path);
  }

  clearThread(threadId: string): void {
    this.entries.delete(threadId);
  }

  clear(): void {
    this.entries.clear();
  }

  matches(
    threadId: string,
    path: string,
    mtimeMs: number,
    offset: number | undefined,
    limit: number | undefined,
  ): ReadFileEntry | undefined {
    const entry = this.entries.get(threadId)?.get(path);
    if (entry === undefined) return undefined;
    if (entry.isPartialView) return undefined;
    if (entry.mtimeMs !== mtimeMs) return undefined;
    if (entry.offset !== offset) return undefined;
    if (entry.limit !== limit) return undefined;
    return entry;
  }
}
