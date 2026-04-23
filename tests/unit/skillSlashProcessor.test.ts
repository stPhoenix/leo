import { describe, expect, it } from 'vitest';
import { createSlashProcessor } from '@/skills/slashProcessor';
import { SkillRegistry } from '@/skills/registry';
import { SkillsStore } from '@/skills/skillsStore';
import { createInvokedSkillsStore } from '@/skills/invokedSkills';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    return this.files.get(p) ?? '';
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {}
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(dir: string): Promise<VaultListing> {
    const prefix = `${dir}/`;
    const folders = [...this.folders]
      .filter((f) => f.startsWith(prefix) && f.slice(prefix.length).length > 0)
      .map((f) => f.slice(0, prefix.length + f.slice(prefix.length).split('/')[0]!.length));
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(prefix)),
      folders: [...new Set(folders)],
    };
  }
}

async function makeRegistry(): Promise<{
  registry: SkillRegistry;
  invoked: ReturnType<typeof createInvokedSkillsStore>;
}> {
  const vault = new FakeVault();
  vault.folders.add('.leo/skills/greet');
  vault.files.set(
    '.leo/skills/greet/SKILL.md',
    `---\nname: greet\ndescription: Greet the user\nallowed-tools: [Bash]\n---\nHello $1.\n`,
  );
  const store = new SkillsStore({ vault });
  await store.loadAll();
  const registry = new SkillRegistry({ store });
  const invoked = createInvokedSkillsStore();
  return { registry, invoked };
}

describe('slash processor', () => {
  it('invokes a skill and produces user-meta messages with command marker', async () => {
    const { registry, invoked } = await makeRegistry();
    const processor = createSlashProcessor({ registry, invoked });
    const result = await processor.process({
      skillName: 'greet',
      args: 'world',
      agentId: '',
      trigger: 'user',
      invocationContext: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages[0]!.marker).toContain('<command-name>greet</command-name>');
    expect(result.messages[0]!.content).toContain('Hello world');
    expect(result.contextModifier?.allowedTools).toEqual(['Bash']);
    expect(invoked.listFor('')).toHaveLength(1);
  });

  it('rejects unknown skills', async () => {
    const { registry, invoked } = await makeRegistry();
    const processor = createSlashProcessor({ registry, invoked });
    const result = await processor.process({
      skillName: 'missing',
      args: '',
      agentId: '',
      trigger: 'user',
      invocationContext: {},
    });
    expect(result.ok).toBe(false);
  });
});
