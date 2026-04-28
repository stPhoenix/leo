export interface ReadFileEntry {
  readonly content: string;
  readonly mtimeMs: number;
  readonly offset: number | undefined;
  readonly limit: number | undefined;
  readonly isPartialView: boolean;
}

export class ReadFileStateStore {
  private readonly entries = new Map<string, ReadFileEntry>();

  get(path: string): ReadFileEntry | undefined {
    return this.entries.get(path);
  }

  set(path: string, entry: ReadFileEntry): void {
    this.entries.set(path, entry);
  }

  invalidate(path: string): void {
    this.entries.delete(path);
  }

  clear(): void {
    this.entries.clear();
  }

  matches(
    path: string,
    mtimeMs: number,
    offset: number | undefined,
    limit: number | undefined,
  ): ReadFileEntry | undefined {
    const entry = this.entries.get(path);
    if (entry === undefined) return undefined;
    if (entry.isPartialView) return undefined;
    if (entry.mtimeMs !== mtimeMs) return undefined;
    if (entry.offset !== offset) return undefined;
    if (entry.limit !== limit) return undefined;
    return entry;
  }
}
