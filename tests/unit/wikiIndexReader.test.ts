import { describe, expect, it } from 'vitest';
import {
  buildSnippet,
  parseWikiIndex,
  scoreEntries,
  summarizeFromBody,
  topNCandidates,
  WIKI_SEARCH_DEFAULT_N,
} from '@/agent/wiki/indexReader';

const SAMPLE_INDEX = `# Wiki index

## Models

- [[pages/large-language-model]] — Generative transformer based language model.
- [[pages/diffusion-model]] — Image generation by iterative denoising.

## Tools

- [[pages/langgraph]] — State graph runtime for LLM agents.
- [[pages/obsidian]] — Local-first knowledge editor.
`;

describe('parseWikiIndex', () => {
  it('parses category headings + bullet wikilinks with summaries', () => {
    const entries = parseWikiIndex(SAMPLE_INDEX);
    expect(entries.length).toBe(4);
    expect(entries[0]).toEqual({
      path: 'wiki/pages/large-language-model.md',
      title: 'large language model',
      category: 'Models',
      summary: 'Generative transformer based language model.',
    });
    expect(entries[2]?.category).toBe('Tools');
    expect(entries[3]?.path).toBe('wiki/pages/obsidian.md');
  });

  it('skips empty lines, non-bullet lines, and bullets without wikilinks', () => {
    const md = `# Wiki index\n\n## Cat\n\nthis is prose\n- not a wikilink\n- [[pages/a]]\n`;
    const entries = parseWikiIndex(md);
    expect(entries.map((e) => e.path)).toEqual(['wiki/pages/a.md']);
  });

  it('strips alias from [[target|alias]] wikilink form', () => {
    const md = `## C\n- [[pages/llm|LLM]] — synonym test\n`;
    const entries = parseWikiIndex(md);
    expect(entries[0]?.path).toBe('wiki/pages/llm.md');
  });
});

describe('scoreEntries + topNCandidates', () => {
  const entries = parseWikiIndex(SAMPLE_INDEX);

  it('ranks title-token hits above summary hits', () => {
    const scored = scoreEntries(entries, 'language model');
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0]?.path).toBe('wiki/pages/large-language-model.md');
  });

  it('drops zero-score entries', () => {
    const scored = scoreEntries(entries, 'unrelated nonsense xyzzy');
    expect(scored).toEqual([]);
  });

  it('topNCandidates truncates to N', () => {
    const scored = topNCandidates(entries, 'model', 1);
    expect(scored.length).toBe(1);
  });

  it('default N is 8', () => {
    expect(WIKI_SEARCH_DEFAULT_N).toBe(8);
  });

  it('empty query returns no hits (stopwords-only also empty)', () => {
    expect(scoreEntries(entries, '')).toEqual([]);
    expect(scoreEntries(entries, 'the and of')).toEqual([]);
  });
});

describe('buildSnippet', () => {
  it('returns excerpt centred on first matched query token', () => {
    const body = 'Intro line. This page covers the language model architecture deeply.';
    const snippet = buildSnippet(body, 'language', 60);
    expect(snippet.toLowerCase()).toContain('language');
  });

  it('returns body prefix when no token matches', () => {
    const body = 'Lorem ipsum dolor sit amet.';
    expect(buildSnippet(body, 'unrelated', 100)).toBe('Lorem ipsum dolor sit amet.');
  });
});

describe('summarizeFromBody', () => {
  it('returns first non-heading non-frontmatter line', () => {
    const body = `---\ntags: [x]\n---\n# Title\n\naliases: foo\n\nThis is the summary line.\n`;
    expect(summarizeFromBody(body, 'fallback')).toBe('This is the summary line.');
  });

  it('falls back when body has no usable line', () => {
    expect(summarizeFromBody('', 'fb')).toBe('fb');
    expect(summarizeFromBody('# only heading', 'fb')).toBe('fb');
  });
});
