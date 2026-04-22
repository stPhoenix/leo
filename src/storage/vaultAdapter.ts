import type { DataAdapter } from 'obsidian';

export interface VaultListing {
  readonly files: readonly string[];
  readonly folders: readonly string[];
}

export interface VaultAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<VaultListing>;
}

export function createObsidianVaultAdapter(adapter: DataAdapter): VaultAdapter {
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
    async rename(from, to) {
      await adapter.rename(from, to);
    },
    async remove(path) {
      await adapter.remove(path);
    },
    async list(path) {
      const result = await adapter.list(path);
      return { files: result.files ?? [], folders: result.folders ?? [] };
    },
  };
}
