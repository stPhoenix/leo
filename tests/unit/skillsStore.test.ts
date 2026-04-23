import { describe, expect, it, vi } from 'vitest';
import { SkillsStore } from '@/skills/skillsStore';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly mkdirs = new Set<string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.mkdirs.add(p);
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
    const dir = p.split('/').slice(0, -1).join('/');
    if (dir.length > 0) this.folders.add(dir);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v === undefined) throw new Error('ENOENT');
    this.files.delete(from);
    this.files.set(to, v);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
    this.folders.delete(p);
  }
  async list(dir: string): Promise<VaultListing> {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const allKeys = [...this.files.keys(), ...this.folders.keys()];
    const files = [...this.files.keys()].filter(
      (k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'),
    );
    const folders = allKeys
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length).split('/')[0]!)
      .filter((seg, idx, arr) => arr.indexOf(seg) === idx && this.folders.has(`${prefix}${seg}`));
    return { files, folders: folders.map((f) => `${prefix}${f}`) };
  }
}

const validSkill = `---\nname: team-custom\ndescription: Team helper\n---\nBody for team skill.\n`;

describe('SkillsStore', () => {
  it('loadAll starts empty and creates .leo/skills on first load', async () => {
    const vault = new FakeVault();
    const store = new SkillsStore({ vault });
    await store.loadAll();
    expect(store.listAll()).toHaveLength(0);
    expect(vault.mkdirs.has('.leo/skills')).toBe(true);
  });

  it('loads skills from .leo/skills/<name>/SKILL.md with source=userSettings', async () => {
    const vault = new FakeVault();
    await vault.mkdir('.leo/skills/team-custom');
    vault.files.set('.leo/skills/team-custom/SKILL.md', validSkill);
    const store = new SkillsStore({ vault });
    await store.loadAll();
    const team = store.find('team-custom');
    expect(team?.source).toBe('userSettings');
    expect(team?.displayName).toBe('team-custom');
    expect(team?.description).toBe('Team helper');
  });

  it('reports invalid SKILL.md files via the notice channel', async () => {
    const vault = new FakeVault();
    await vault.mkdir('.leo/skills/bad');
    vault.files.set('.leo/skills/bad/SKILL.md', '---\nname: bad\n---\n');
    const notice = { notify: vi.fn() };
    const warns: string[] = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (event: string) => warns.push(event),
      error: () => undefined,
    } as unknown as ConstructorParameters<typeof SkillsStore>[0]['logger'];
    const store = new SkillsStore({ vault, logger, noticeChannel: notice });
    await store.loadAll();
    expect(warns).toContain('skills.load.invalid');
    expect(notice.notify).toHaveBeenCalledTimes(1);
  });

  it('migrates legacy flat skills on loadAll', async () => {
    const vault = new FakeVault();
    await vault.mkdir('.leo/skills');
    vault.files.set(
      '.leo/skills/legacy.json',
      JSON.stringify({
        id: 'legacy',
        name: 'Legacy',
        description: 'Was flat',
        systemPrompt: 'Do the thing.',
      }),
    );
    const store = new SkillsStore({ vault });
    await store.loadAll();
    expect(vault.files.has('.leo/skills/legacy.json')).toBe(false);
    expect(vault.files.has('.leo/skills/legacy/SKILL.md')).toBe(true);
    const skill = store.find('legacy');
    expect(skill?.description).toBe('Was flat');
  });

  it('routes paths: skills into the conditional pool', async () => {
    const vault = new FakeVault();
    await vault.mkdir('.leo/skills/typed');
    vault.files.set(
      '.leo/skills/typed/SKILL.md',
      `---\nname: typed\ndescription: Only for TS\npaths: ["src/**/*.ts"]\n---\nTriggered by TS.\n`,
    );
    const store = new SkillsStore({ vault });
    await store.loadAll();
    expect(store.listAvailable().find((s) => s.name === 'typed')).toBeUndefined();
    expect(store.conditionalEntries()).toHaveLength(1);
  });
});
