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
  async stat(): Promise<null> {
    return null;
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
    const slug = await store.currentSlug('s-1');
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
    expect(await store.currentSlug('s-1')).toBe(slug);
    await store.writePlan('s-1', '# plan');
    expect(await store.readPlan('s-1')).toBe('# plan');
  });

  it('caches slugs independently per session', async () => {
    const vault = new FakeVault();
    // Different random sequences for each call so the second session gets a different slug
    let call = 0;
    const random = (): number => {
      call += 1;
      return ((call * 0.137) % 1) as number;
    };
    const store = new PlanStore({ vault, random });
    const slugA = await store.currentSlug('a');
    const slugB = await store.currentSlug('b');
    expect(slugA).toMatch(/^[a-z]+-[a-z]+$/);
    expect(slugB).toMatch(/^[a-z]+-[a-z]+$/);
    expect(await store.currentSlug('a')).toBe(slugA);
    expect(await store.currentSlug('b')).toBe(slugB);
  });

  it('setSlug overrides the cached slug for a session', async () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault, random: seededRandom([0.1, 0.2]) });
    store.setSlug('s-1', 'foo-bar');
    expect(await store.currentSlug('s-1')).toBe('foo-bar');
    await store.writePlan('s-1', '# plan');
    expect(vault.files.has(`${DEFAULT_PLANS_DIR}/foo-bar.md`)).toBe(true);
  });

  it('setSlug rejects invalid slug shapes', () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault });
    expect(() => store.setSlug('s-1', 'bad slug')).toThrow(PlanPathEscape);
    expect(() => store.setSlug('s-1', '../escape')).toThrow(PlanPathEscape);
  });

  it('resetSlug clears the cache for that session only', async () => {
    const vault = new FakeVault();
    const store = new PlanStore({ vault, random: seededRandom([0.1, 0.2]) });
    await store.currentSlug('a');
    const slugB = await store.currentSlug('b');
    store.resetSlug('a');
    const slugA2 = await store.currentSlug('a');
    expect(await store.currentSlug('b')).toBe(slugB);
    expect(slugA2).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('retries on collision up to 10 times then throws PlanSlugExhausted', async () => {
    const always = new FakeVault();
    always.exists = async () => true;
    const store = new PlanStore({ vault: always, random: Math.random });
    await expect(store.currentSlug('s-1')).rejects.toBeInstanceOf(PlanSlugExhausted);
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
