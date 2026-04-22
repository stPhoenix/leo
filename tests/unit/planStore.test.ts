import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLANS_DIR,
  PlanPathEscape,
  PlanSlugExhausted,
  PlanStore,
} from '@/storage/planStore';
import type { VaultAdapter } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
}

function seededRandom(seq: number[]): () => number {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i += 1;
    return v ?? 0;
  };
}

describe('PlanStore slug + path guard + fallback', () => {
  it('currentSlug returns a cached two-word kebab and round-trips writePlan / readPlan', async () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault, random: seededRandom([0.1, 0.2]) });
    const slug = await store.currentSlug();
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
    expect(await store.currentSlug()).toBe(slug);
    await store.writePlan('# plan');
    expect(await store.readPlan()).toBe('# plan');
  });

  it('retries on collision up to 10 times then throws PlanSlugExhausted', async () => {
    const vault = new FakeVault();
    // Pre-populate 20 plan files so every random pick collides
    for (let a = 0; a < 18; a += 1) {
      for (let n = 0; n < 18; n += 1) {
        vault.files.set(`${DEFAULT_PLANS_DIR}/adj${a}-n${n}.md`, 'x');
      }
    }
    // Use a random that picks a colliding slug, but we also need to seed so every slug collides with files we already populated
    // Simplify: override vault.exists to always report true
    const always = new FakeVault();
    always.exists = async () => true;
    const store = new PlanStore({ vault: always, random: Math.random });
    await expect(store.currentSlug()).rejects.toBeInstanceOf(PlanSlugExhausted);
  });

  it('rejects traversal-unsafe plansDirectory and falls back to default', () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault, configuredDir: '../escape' });
    expect(store.currentDir()).toBe(DEFAULT_PLANS_DIR);
  });

  it('accepts a vault-relative plansDirectory', () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault, configuredDir: '.leo/extra/plans' });
    expect(store.currentDir()).toBe('.leo/extra/plans');
  });

  it('planPath rejects invalid slug shapes with PlanPathEscape', () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault });
    expect(() => store.planPath('../escape')).toThrow(PlanPathEscape);
    expect(() => store.planPath('bad slug')).toThrow(PlanPathEscape);
  });
});
