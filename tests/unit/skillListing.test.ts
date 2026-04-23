import { describe, expect, it } from 'vitest';
import { buildSkillListingAttachment } from '@/skills/listingAttachment';
import { SkillRegistry, MAIN_AGENT_ID } from '@/skills/registry';
import { SkillsStore } from '@/skills/skillsStore';
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
      .filter((f) => f.startsWith(prefix))
      .map((f) => f.slice(0, prefix.length + f.slice(prefix.length).split('/')[0]!.length));
    const unique = [...new Set(folders)];
    return {
      files: [...this.files.keys()].filter((k) => k.startsWith(prefix)),
      folders: unique,
    };
  }
}

function makeRegistryWithSkills(count: number): SkillRegistry {
  const vault = new FakeVault();
  for (let i = 0; i < count; i += 1) {
    const name = `skill-${i}`;
    vault.folders.add(`.leo/skills/${name}`);
    vault.files.set(
      `.leo/skills/${name}/SKILL.md`,
      `---\nname: ${name}\ndescription: Example skill ${i}\nwhen_to_use: Use it when i=${i}\n---\nBody ${i}.\n`,
    );
  }
  const store = new SkillsStore({ vault });
  return { store } as unknown as SkillRegistry;
}

describe('buildSkillListingAttachment', () => {
  it('returns null when no skills are available', async () => {
    const vault = new FakeVault();
    const store = new SkillsStore({ vault });
    await store.loadAll();
    const registry = new SkillRegistry({ store });
    const result = buildSkillListingAttachment({ registry, agentId: MAIN_AGENT_ID });
    expect(result).toBeNull();
  });

  it('lists available skills once and suppresses future sends for the same agent', async () => {
    const vault = new FakeVault();
    vault.folders.add('.leo/skills/foo');
    vault.files.set(
      '.leo/skills/foo/SKILL.md',
      `---\nname: foo\ndescription: Foo helper\n---\nBody.\n`,
    );
    const store = new SkillsStore({ vault });
    await store.loadAll();
    const registry = new SkillRegistry({ store });
    const first = buildSkillListingAttachment({ registry, agentId: MAIN_AGENT_ID });
    expect(first).not.toBeNull();
    expect(first!.content).toContain('- foo: Foo helper');
    expect(first!.skillCount).toBe(1);
    const second = buildSkillListingAttachment({ registry, agentId: MAIN_AGENT_ID });
    expect(second).toBeNull();
  });

  void makeRegistryWithSkills; // silence unused during lint
});
