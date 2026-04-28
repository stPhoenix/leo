// Guards F02 contract: no built-in tool factory may receive a `vault:
// VaultAdapter` or `bridge: EditNoteBridge` parameter at construction time.
// All IO must flow through `ctx.vault` / `ctx.editor` on invoke.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BUILTIN_TOOL_FILES = [
  'src/tools/builtin/readNote.ts',
  'src/tools/builtin/createNote.ts',
  'src/tools/builtin/appendToNote.ts',
  'src/tools/builtin/createFolder.ts',
  'src/tools/builtin/editNote.ts',
  'src/tools/builtin/searchVault.ts',
  'src/tools/builtin/skillTool.ts',
  'src/tools/todoWriteTool.ts',
  'src/tools/planModeTools.ts',
];

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf-8');
}

describe('F02 — built-in tools must not close over vault/editor at module scope', () => {
  it('no built-in tool file imports VaultAdapter as a value — only as type, if at all', () => {
    for (const path of BUILTIN_TOOL_FILES) {
      const src = read(path);
      // Allow `import type { VaultAdapter }` but not `import { VaultAdapter }`.
      const valueImport =
        /^import\s+\{[^}]*\bVaultAdapter\b[^}]*\}\s+from\s+'@\/storage\/vaultAdapter'/m;
      expect(valueImport.test(src), `${path}: VaultAdapter imported as value`).toBe(false);
    }
  });

  it('no built-in tool factory declares a `vault:` or `bridge:` parameter in createXxxTool signature', () => {
    for (const path of BUILTIN_TOOL_FILES) {
      const src = read(path);
      // Find every `export function createXxxTool(` signature and peek the following ~5 lines.
      const factoryRegex = /export function create\w+Tool\s*\(([\s\S]*?)\)\s*:/g;
      let match: RegExpExecArray | null;
      while ((match = factoryRegex.exec(src)) !== null) {
        const paramSource = match[1] ?? '';
        expect(
          /\bvault\s*:/.test(paramSource),
          `${path}: factory signature accepts \`vault:\` — should flow via ctx.vault`,
        ).toBe(false);
        expect(
          /\bbridge\s*:/.test(paramSource),
          `${path}: factory signature accepts \`bridge:\` — should flow via ctx.editor`,
        ).toBe(false);
      }
    }
  });

  it('edit_note reads editor ops via ctx.editor, not a closure', () => {
    const src = read('src/tools/builtin/editNote.ts');
    expect(src.includes('ctx.editor.isActiveNote')).toBe(true);
    expect(src.includes('ctx.editor.applyActiveEdit')).toBe(true);
  });

  it('read/write/folder tools read vault ops via ctx.vault, not a closure', () => {
    for (const path of [
      'src/tools/builtin/readNote.ts',
      'src/tools/builtin/createNote.ts',
      'src/tools/builtin/appendToNote.ts',
      'src/tools/builtin/createFolder.ts',
    ]) {
      const src = read(path);
      expect(
        /ctx\.vault\.(read|write|exists|mkdir)/.test(src),
        `${path}: no ctx.vault.* usage`,
      ).toBe(true);
    }
  });
});
