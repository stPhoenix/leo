import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = fileURLToPath(new URL('../../styles.css', import.meta.url));

describe('styles.css — Obsidian CSS-variable-only audit (FR-UI-03, NFR-USE-10)', () => {
  const css = readFileSync(stylesPath, 'utf8');

  it('contains no hex colour literals', () => {
    const matches = css.match(/#[0-9a-f]{3,8}\b/gi);
    expect(matches).toBeNull();
  });

  it('contains no rgb()/rgba() colour literals', () => {
    const matches = css.match(/\brgba?\s*\(/gi);
    expect(matches).toBeNull();
  });

  it('contains no hsl()/hsla() colour literals', () => {
    const matches = css.match(/\bhsla?\s*\(/gi);
    expect(matches).toBeNull();
  });

  it('uses Obsidian theme variables for colours, borders, and backgrounds', () => {
    expect(css).toMatch(/var\(--background-primary\)/);
    expect(css).toMatch(/var\(--text-normal\)/);
    expect(css).toMatch(/var\(--interactive-accent\)/);
    expect(css).toMatch(/var\(--background-modifier-border\)/);
  });

  it('declares the mandated z-index tokens (NFR-USE-11) in ascending order', () => {
    expect(css).toMatch(/--leo-z-content:\s*0/);
    expect(css).toMatch(/--leo-z-editlock:\s*100/);
    expect(css).toMatch(/--leo-z-tooltip:\s*800/);
    expect(css).toMatch(/--leo-z-inline-dialog:\s*900/);
  });

  it('honours prefers-reduced-motion by suppressing transitions/animations', () => {
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/);
  });
});
