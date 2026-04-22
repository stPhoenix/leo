import { describe, expect, it } from 'vitest';
import { TARGET_NOTE_PATH, TINY_VAULT_NOTE_COUNT, makeTinyVault } from './fixtures/tinyVault';

describe('F57 smoke suite — tinyVault fixture', () => {
  it('yields TINY_VAULT_NOTE_COUNT notes with a designated target', () => {
    const vault = makeTinyVault();
    expect(vault.notes.length).toBe(TINY_VAULT_NOTE_COUNT);
    expect(vault.target.path).toBe(TARGET_NOTE_PATH);
    expect(vault.target.isTarget).toBe(true);
    expect(vault.notes.filter((n) => n.isTarget === true).length).toBe(1);
  });

  it('is deterministic: two invocations produce byte-identical JSON', () => {
    const a = makeTinyVault();
    const b = makeTinyVault();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every note carries frontmatter tags + non-empty body', () => {
    const vault = makeTinyVault();
    for (const note of vault.notes) {
      expect(note.tags.length).toBeGreaterThan(0);
      expect(note.tags).toContain('smoke');
      expect(note.body).toMatch(/^---\n/);
      expect(note.body).toContain('# ');
    }
  });

  it('each link points at another note.path present in the vault', () => {
    const vault = makeTinyVault();
    const paths = new Set(vault.notes.map((n) => n.path));
    for (const n of vault.notes) {
      for (const link of n.links) {
        expect(paths.has(link)).toBe(true);
      }
    }
  });
});
