import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';

export class InMemoryVaultAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();

  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.folders.has(p);
  }

  async mkdir(p: string): Promise<void> {
    this.folders.add(p);
  }

  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  }

  async write(p: string, data: string): Promise<void> {
    this.files.set(p, data);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.files.has(from)) {
      const data = this.files.get(from)!;
      this.files.delete(from);
      this.files.set(to, data);
      return;
    }
    throw new Error(`ENOENT: ${from}`);
  }

  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }

  async list(p: string): Promise<VaultListing> {
    const prefix = p.endsWith('/') ? p : `${p}/`;
    const files: string[] = [];
    const folders: string[] = [];
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) files.push(k);
    }
    for (const k of this.folders) {
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) folders.push(k);
    }
    return { files, folders };
  }

  async stat(p: string): Promise<VaultStat | null> {
    if (this.files.has(p)) {
      return { mtimeMs: 0, size: this.files.get(p)!.length, kind: 'file' };
    }
    if (this.folders.has(p)) {
      return { mtimeMs: 0, size: 0, kind: 'folder' };
    }
    return null;
  }
}
