import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { BUILTIN_IDS, BUILTIN_SKILLS } from './builtins';
import { parseSkillFile, serializeSkillJson } from './parse';
import type { Skill } from './types';

const DEFAULT_DIR = '.leo/skills';

export interface SkillsStoreOptions {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly dir?: string;
  readonly noticeChannel?: { notify(message: string): void } | null;
}

export class SkillsStore {
  private readonly vault: VaultAdapter;
  private readonly logger: Logger | undefined;
  private readonly dir: string;
  private readonly noticeChannel: { notify(message: string): void } | null;
  private readonly cache = new Map<string, Skill>();
  private loaded = false;
  private noticeFiredThisLoad = false;

  constructor(opts: SkillsStoreOptions) {
    this.vault = opts.vault;
    this.logger = opts.logger;
    this.dir = opts.dir ?? DEFAULT_DIR;
    this.noticeChannel = opts.noticeChannel ?? null;
  }

  async loadAll(): Promise<void> {
    this.cache.clear();
    this.noticeFiredThisLoad = false;
    for (const b of BUILTIN_SKILLS) this.cache.set(b.id, b);
    try {
      await this.vault.mkdir(this.dir);
    } catch {
      /* best effort */
    }
    let listing: { readonly files: readonly string[]; readonly folders: readonly string[] };
    try {
      listing = await this.vault.list(this.dir);
    } catch (err) {
      this.logger?.warn('skills.load.list-failed', {
        dir: this.dir,
        error: err instanceof Error ? err.message : String(err),
      });
      this.loaded = true;
      return;
    }
    for (const rawPath of listing.files) {
      const path = stripDirPrefix(rawPath, this.dir);
      if (!path.endsWith('.json') && !path.endsWith('.md')) continue;
      await this.loadOne(`${this.dir}/${path}`);
    }
    this.loaded = true;
  }

  async loadOne(path: string): Promise<void> {
    const filename = path.split('/').pop() ?? path;
    let content: string;
    try {
      content = await this.vault.read(path);
    } catch (err) {
      this.reportInvalid(path, err instanceof Error ? err.message : String(err));
      return;
    }
    const parsed = parseSkillFile(content, filename, { source: 'user' });
    if (!parsed.ok) {
      this.reportInvalid(path, parsed.error);
      return;
    }
    if (this.cache.has(parsed.skill.id)) {
      this.logger?.warn('skills.load.duplicate', {
        path,
        id: parsed.skill.id,
      });
      return;
    }
    this.cache.set(parsed.skill.id, parsed.skill);
    this.logger?.debug('skills.load.ok', { id: parsed.skill.id, path });
  }

  invalidate(id: string): void {
    if (!BUILTIN_IDS.has(id)) this.cache.delete(id);
  }

  list(): readonly Skill[] {
    return [...this.cache.values()];
  }

  get(id: string): Skill | undefined {
    return this.cache.get(id);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async save(skill: Skill): Promise<void> {
    if (BUILTIN_IDS.has(skill.id)) {
      throw new Error(`cannot save over builtin skill id: ${skill.id}`);
    }
    if (skill.source !== 'user') {
      throw new Error(`cannot save non-user skill: source=${skill.source}`);
    }
    const path = `${this.dir}/${skill.id}.json`;
    await this.vault.mkdir(this.dir);
    await this.vault.write(path, serializeSkillJson(skill));
    this.cache.set(skill.id, skill);
    this.logger?.info('skills.save', { id: skill.id, path });
  }

  async delete(id: string): Promise<void> {
    if (BUILTIN_IDS.has(id)) {
      throw new Error(`cannot delete builtin skill id: ${id}`);
    }
    const path = `${this.dir}/${id}.json`;
    if (await this.vault.exists(path)) {
      await this.vault.remove(path);
    }
    this.cache.delete(id);
    this.logger?.info('skills.delete', { id });
  }

  async cloneBuiltin(sourceId: string, newId: string): Promise<Skill> {
    const source = this.cache.get(sourceId);
    if (source === undefined || source.source !== 'builtin') {
      throw new Error(`unknown builtin skill id: ${sourceId}`);
    }
    if (BUILTIN_IDS.has(newId)) {
      throw new Error(`target id conflicts with builtin: ${newId}`);
    }
    if (this.cache.has(newId)) {
      throw new Error(`target id already exists: ${newId}`);
    }
    const clone: Skill = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
      source: 'user',
    };
    await this.save(clone);
    return clone;
  }

  private reportInvalid(path: string, issue: string): void {
    this.logger?.warn('skills.load.invalid', { path, issue });
    if (!this.noticeFiredThisLoad && this.noticeChannel !== null) {
      this.noticeChannel.notify(`Leo: skipped invalid skill file ${path} (${issue})`);
      this.noticeFiredThisLoad = true;
    }
  }
}

function stripDirPrefix(full: string, dir: string): string {
  if (full.startsWith(`${dir}/`)) return full.slice(dir.length + 1);
  return full;
}
