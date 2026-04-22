import { describe, expect, it, vi } from 'vitest';
import { SkillsStore } from '@/skills/skillsStore';
import { parseSkillFile } from '@/skills/parse';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly mkdirs = new Set<string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.mkdirs.add(p);
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v === undefined) throw new Error('ENOENT');
    this.files.delete(from);
    this.files.set(to, v);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(dir: string): Promise<VaultListing> {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(prefix)),
      folders: [],
    };
  }
}

describe('parseSkillFile — JSON vs markdown frontmatter parse equivalence', () => {
  it('parses a valid JSON skill', () => {
    const json = JSON.stringify({
      id: 'x',
      name: 'X',
      description: 'd',
      systemPrompt: 'sys',
      allowedTools: ['read_note'],
      defaultModel: 'gpt-4',
    });
    const r = parseSkillFile(json, 'x.json', { source: 'user' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skill.id).toBe('x');
      expect(r.skill.allowedTools).toEqual(['read_note']);
      expect(r.skill.defaultModel).toBe('gpt-4');
      expect(r.skill.source).toBe('user');
    }
  });

  it('parses a valid markdown skill with YAML frontmatter + body as systemPrompt', () => {
    const md = `---
id: y
name: Y
description: description
allowedTools: [read_note, search_vault]
defaultModel: gpt-4
---
Hello I am the system prompt.

Line two.`;
    const r = parseSkillFile(md, 'y.md', { source: 'user' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skill.id).toBe('y');
      expect(r.skill.allowedTools).toEqual(['read_note', 'search_vault']);
      expect(r.skill.systemPrompt).toContain('Hello I am the system prompt.');
      expect(r.skill.systemPrompt).toContain('Line two.');
    }
  });

  it('JSON and markdown of the same content round-trip to the same Skill shape (minus formatting)', () => {
    const json = parseSkillFile(
      JSON.stringify({ id: 'r', name: 'R', description: 'd', systemPrompt: 'SP' }),
      'r.json',
      { source: 'user' },
    );
    const md = parseSkillFile(`---\nid: r\nname: R\ndescription: d\n---\nSP`, 'r.md', {
      source: 'user',
    });
    expect(json.ok).toBe(true);
    expect(md.ok).toBe(true);
    if (json.ok && md.ok) expect({ ...json.skill }).toEqual({ ...md.skill });
  });

  it('rejects skills with missing required fields', () => {
    const r = parseSkillFile(JSON.stringify({ id: 'x', name: 'X' }), 'x.json', { source: 'user' });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const r = parseSkillFile('{not json', 'x.json', { source: 'user' });
    expect(r.ok).toBe(false);
  });

  it('rejects slug-invalid ids', () => {
    const r = parseSkillFile(
      JSON.stringify({ id: 'has spaces', name: 'N', description: 'd', systemPrompt: 's' }),
      'x.json',
      { source: 'user' },
    );
    expect(r.ok).toBe(false);
  });
});

describe('SkillsStore', () => {
  it('loadAll starts empty and creates .leo/skills on first load', async () => {
    const vault = new FakeVault();
    const store = new SkillsStore({ vault });
    await store.loadAll();
    expect(store.list()).toHaveLength(0);
    expect(vault.mkdirs.has('.leo/skills')).toBe(true);
  });

  it('loads user skills from .leo/skills and tags source=user', async () => {
    const vault = new FakeVault();
    vault.files.set(
      '.leo/skills/team.json',
      JSON.stringify({
        id: 'team-custom',
        name: 'Team custom',
        description: 'd',
        systemPrompt: 'sys',
      }),
    );
    const store = new SkillsStore({ vault });
    await store.loadAll();
    const team = store.get('team-custom');
    expect(team?.source).toBe('user');
  });

  it('skips invalid skill files, logs skills.load.invalid, and fires a one-time Notice', async () => {
    const vault = new FakeVault();
    vault.files.set('.leo/skills/bad.json', '{not json');
    vault.files.set('.leo/skills/bad2.json', JSON.stringify({ id: 'x', name: 'X' }));
    const notice = { notify: vi.fn() };
    const records: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (event: string, fields: Record<string, unknown>) => records.push({ event, fields }),
      error: () => undefined,
    } as unknown as ConstructorParameters<typeof SkillsStore>[0]['logger'];
    const store = new SkillsStore({ vault, logger, noticeChannel: notice });
    await store.loadAll();
    const invalids = records.filter((r) => r.event === 'skills.load.invalid');
    expect(invalids.length).toBeGreaterThanOrEqual(2);
    expect(notice.notify).toHaveBeenCalledTimes(1);
  });

  it('loadOne refreshes a single entry when a user file is added at runtime', async () => {
    const vault = new FakeVault();
    const store = new SkillsStore({ vault });
    await store.loadAll();
    expect(store.get('later')).toBeUndefined();
    vault.files.set(
      '.leo/skills/later.json',
      JSON.stringify({
        id: 'later',
        name: 'Later',
        description: 'd',
        systemPrompt: 's',
      }),
    );
    await store.loadOne('.leo/skills/later.json');
    expect(store.get('later')?.source).toBe('user');
  });
});
