import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SENSITIVE_FIELD_KEYS } from '@/agent/externalAgent/loggingNamespaces';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');

const SCAN_PATHS: readonly string[] = [
  'src/agent/externalAgent',
  'src/tools/builtin/delegateExternal.ts',
];

function listFiles(absPath: string): string[] {
  const out: string[] = [];
  let stat;
  try {
    stat = statSync(absPath);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (absPath.endsWith('.ts') || absPath.endsWith('.tsx')) out.push(absPath);
    return out;
  }
  for (const entry of readdirSync(absPath)) {
    out.push(...listFiles(join(absPath, entry)));
  }
  return out;
}

const sourceFiles = SCAN_PATHS.flatMap((p) => listFiles(join(PROJECT_ROOT, p)));

describe('NFR-EXT-05 — logger field keys', () => {
  it('discovered at least one source file to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const file of sourceFiles) {
    it(`${file.replace(PROJECT_ROOT + '/', '')} — no sensitive field keys at info|warn|error`, () => {
      const text = readFileSync(file, 'utf8');
      // Match logger.info|warn|error('...', { ... }) call sites.
      const re = /logger\?\.?\.(info|warn|error)\(\s*'[^']+'\s*,\s*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const fields = m[2] ?? '';
        for (const key of SENSITIVE_FIELD_KEYS) {
          // Match `key:` or `key,` or `key }` to skip substring matches like
          // `myRefinedPromptCount`.
          const fieldRe = new RegExp(`\\b${key}\\b\\s*[,:}]`);
          expect(
            fieldRe.test(fields),
            `${file}: ${m[0].slice(0, 80)} contains sensitive key ${key}`,
          ).toBe(false);
        }
      }
    });
  }
});

describe('NFR-EXT-05 — no console.* in external-agent source (per OQ-01-F13)', () => {
  for (const file of sourceFiles) {
    it(`${file.replace(PROJECT_ROOT + '/', '')} — no console.{log,info,warn,error,debug}`, () => {
      const text = readFileSync(file, 'utf8');
      const re = /\bconsole\.(log|info|warn|error|debug)\s*\(/;
      expect(re.test(text), `${file}: must not call console.* — use Logger`).toBe(false);
    });
  }
});

describe('NFR-EXT-02 — adapter file imports are restricted (already enforced by ESLint)', () => {
  it('every file under src/agent/externalAgent/adapters/ except base.ts has at most allowed imports', () => {
    const adaptersDir = join(PROJECT_ROOT, 'src/agent/externalAgent/adapters');
    let entries: string[] = [];
    try {
      entries = readdirSync(adaptersDir);
    } catch {
      return; // Directory may not exist if no adapters yet.
    }
    const FORBIDDEN_PREFIXES = [
      "from '@/agent/",
      "from '@/chat/",
      "from '@/ui/",
      "from '@/storage/",
      "from '@/editor/",
      "from '@/providers/",
      "from '@/skills/",
      "from '@/tools/",
      "from '@/settings/",
      "from '@/indexer/",
      "from '@/rag/",
      "from '@/mcp/",
      "from '@/platform/",
    ];
    for (const entry of entries) {
      if (entry === 'base.ts') continue;
      if (!entry.endsWith('.ts')) continue;
      const text = readFileSync(join(adaptersDir, entry), 'utf8');
      for (const prefix of FORBIDDEN_PREFIXES) {
        expect(text.includes(prefix), `${entry}: forbidden import ${prefix}`).toBe(false);
      }
    }
  });
});
