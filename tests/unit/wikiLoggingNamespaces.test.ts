import { describe, expect, it } from 'vitest';
import { WIKI_LOG, WIKI_SENSITIVE_FIELD_KEYS } from '@/agent/wiki/loggingNamespaces';

describe('WIKI_LOG namespaces', () => {
  it('groups namespaces under wiki.ingest.* / wiki.lint.* / wiki.search.*', () => {
    const events = collectStrings(WIKI_LOG);
    const ingest = events.filter((e) => e.startsWith('wiki.ingest.'));
    const lint = events.filter((e) => e.startsWith('wiki.lint.'));
    const search = events.filter((e) => e.startsWith('wiki.search.'));
    expect(ingest.length).toBeGreaterThan(0);
    expect(lint.length).toBeGreaterThan(0);
    expect(search.length).toBeGreaterThan(0);
  });

  it('every event is dot-separated and lowercase', () => {
    for (const ev of collectStrings(WIKI_LOG)) {
      expect(ev).toMatch(/^[a-z][a-z0-9.-]*$/);
      expect(ev.includes('.')).toBe(true);
    }
  });

  it('includes the canonical bootstrap.done event consumed by F01', () => {
    expect(WIKI_LOG.bootstrap.done).toBe('wiki.bootstrap.done');
  });
});

describe('WIKI_SENSITIVE_FIELD_KEYS', () => {
  it('lists raw / extractor / page / source body keys', () => {
    expect(WIKI_SENSITIVE_FIELD_KEYS).toContain('rawBody');
    expect(WIKI_SENSITIVE_FIELD_KEYS).toContain('extractorOutput');
    expect(WIKI_SENSITIVE_FIELD_KEYS).toContain('reducerOutput');
    expect(WIKI_SENSITIVE_FIELD_KEYS).toContain('pageBody');
  });
});

function collectStrings(node: unknown): string[] {
  const out: string[] = [];
  if (typeof node === 'string') {
    out.push(node);
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      out.push(...collectStrings(value));
    }
  }
  return out;
}
