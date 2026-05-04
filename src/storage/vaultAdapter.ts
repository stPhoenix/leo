import { TFile, type App, type DataAdapter } from 'obsidian';

export interface VaultListing {
  readonly files: readonly string[];
  readonly folders: readonly string[];
}

export interface VaultStat {
  readonly mtimeMs: number;
  readonly size: number;
  readonly kind?: 'file' | 'folder';
}

export interface VaultAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  writeBinary?(path: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  renameWithLinks?(from: string, to: string): Promise<void>;
  copy?(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  rmdir?(path: string): Promise<void>;
  list(path: string): Promise<VaultListing>;
  stat(path: string): Promise<VaultStat | null>;
}

export function createObsidianVaultAdapter(adapter: DataAdapter, app?: App): VaultAdapter {
  return {
    async exists(path) {
      return adapter.exists(path);
    },
    async mkdir(path) {
      if (!(await adapter.exists(path))) {
        await adapter.mkdir(path);
      }
    },
    async read(path) {
      return adapter.read(path);
    },
    async write(path, data) {
      await adapter.write(path, data);
    },
    async writeBinary(path, data) {
      const view = new Uint8Array(data);
      const buf = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
      await adapter.writeBinary(path, buf as ArrayBuffer);
    },
    async rename(from, to) {
      await adapter.rename(from, to);
    },
    async renameWithLinks(from, to) {
      if (app !== undefined) {
        const file = app.vault.getAbstractFileByPath(from);
        if (file instanceof TFile) {
          await app.fileManager.renameFile(file, to);
          return;
        }
      }
      await adapter.rename(from, to);
    },
    async copy(from, to) {
      await adapter.copy(from, to);
    },
    async remove(path) {
      await adapter.remove(path);
    },
    async rmdir(path) {
      await adapter.rmdir(path, false);
    },
    async list(path) {
      const result = await adapter.list(path);
      return { files: result.files ?? [], folders: result.folders ?? [] };
    },
    async stat(path) {
      try {
        const raw = await adapter.stat(path);
        if (raw === null || raw === undefined) return null;
        const mtimeMs = typeof raw.mtime === 'number' ? raw.mtime : 0;
        const size = typeof raw.size === 'number' ? raw.size : 0;
        const kind: 'file' | 'folder' = raw.type === 'folder' ? 'folder' : 'file';
        return { mtimeMs, size, kind };
      } catch {
        return null;
      }
    },
  };
}
