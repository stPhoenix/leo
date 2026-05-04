import { describe, expect, it } from 'vitest';
import {
  applyMarkdownPatch,
  findSection,
  splitFrontmatter,
  stripSourcesSection,
} from '@/agent/wiki/lint/markdownPatch';

describe('splitFrontmatter', () => {
  it('returns empty frontmatter when none present', () => {
    expect(splitFrontmatter('# Title\n\nbody')).toEqual({
      frontmatter: '',
      rest: '# Title\n\nbody',
    });
  });

  it('extracts frontmatter block including delimiters with trailing newline', () => {
    const input = '---\ntitle: x\ntags: [a]\n---\n\n# Title\n\nbody';
    const out = splitFrontmatter(input);
    expect(out.frontmatter).toBe('---\ntitle: x\ntags: [a]\n---\n');
    expect(out.rest).toBe('# Title\n\nbody');
  });

  it('treats malformed frontmatter (no closing ---) as no frontmatter', () => {
    const input = '---\ntitle: x\nno closing\n# Title';
    const out = splitFrontmatter(input);
    expect(out.frontmatter).toBe('');
    expect(out.rest).toBe(input);
  });
});

describe('stripSourcesSection', () => {
  it('returns content unchanged when no sources section', () => {
    expect(stripSourcesSection('# A\n\nbody')).toEqual({
      content: '# A\n\nbody',
      sourcesBlock: '',
    });
  });

  it('removes ## Sources block, case-insensitive, until next sibling heading', () => {
    const input = '# Title\n\nbody\n\n## Sources\n\n- [[s1]]\n- [[s2]]\n\n## Notes\nmore';
    const out = stripSourcesSection(input);
    expect(out.sourcesBlock).toBe('## Sources\n\n- [[s1]]\n- [[s2]]\n');
    expect(out.content).toBe('# Title\n\nbody\n\n## Notes\nmore');
  });

  it('removes a trailing sources block to EOF', () => {
    const input = '# Title\n\nbody\n\n## sources\n\n- [[s1]]';
    const out = stripSourcesSection(input);
    expect(out.sourcesBlock.startsWith('## sources')).toBe(true);
    expect(out.content).toBe('# Title\n\nbody');
  });
});

describe('findSection', () => {
  it('locates a section and returns its line range', () => {
    const content = '# Top\n\nintro\n\n## Foo\n\nfoo body\n\n### nested\n\nnested\n\n## Bar\n\nbar';
    const range = findSection(content, 'Foo');
    expect(range).not.toBeNull();
    expect(range!.level).toBe(2);
    const lines = content.split('\n');
    expect(lines[range!.startLine]).toBe('## Foo');
    expect(lines[range!.endLine]).toBe('## Bar');
  });

  it('returns null when section is missing', () => {
    expect(findSection('# a\n\nbody', 'Missing')).toBeNull();
  });
});

describe('applyMarkdownPatch — replace_body', () => {
  const original =
    '---\ntitle: x\n---\n\n# Title\n\nbody one with several paragraphs of context content here.\n\n## Sources\n\n- [[s]]';

  it('happy path preserves frontmatter and sources block', () => {
    const result = applyMarkdownPatch({
      currentBody: original,
      patch: {
        kind: 'replace_body',
        body: '# Title\n\nbody two with a similarly sized paragraph of content here.',
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextBody).toContain('---\ntitle: x\n---');
    expect(result.nextBody).toContain('body two');
    expect(result.nextBody).toContain('## Sources');
    expect(result.changed).toBe(true);
  });

  it('strips body’s accidental frontmatter and sources', () => {
    const stray = '---\ntitle: stray\n---\n\n# Title\n\nbody two\n\n## Sources\n\n- [[bogus]]';
    const result = applyMarkdownPatch({
      currentBody: original,
      patch: { kind: 'replace_body', body: stray },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextBody).not.toContain('title: stray');
    expect(result.nextBody).not.toContain('bogus');
    expect(result.nextBody).toContain('- [[s]]');
  });

  it('refuses replace_body when size delta exceeds 50%', () => {
    const result = applyMarkdownPatch({
      currentBody: 'x'.repeat(1000),
      patch: { kind: 'replace_body', body: 'y' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('body_size_drift');
  });
});

describe('applyMarkdownPatch — replace_section', () => {
  const original =
    '---\nt: x\n---\n\n# Top\n\nintro\n\n## Foo\n\nfoo old\n\n### nested\n\nstuff\n\n## Bar\n\nbar\n\n## Sources\n\n- [[s]]';

  it('replaces a section while preserving siblings, frontmatter and sources', () => {
    const result = applyMarkdownPatch({
      currentBody: original,
      patch: { kind: 'replace_section', section: 'Foo', body: 'foo new' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextBody).toContain('## Foo\n\nfoo new');
    expect(result.nextBody).not.toContain('foo old');
    expect(result.nextBody).not.toContain('### nested');
    expect(result.nextBody).toContain('## Bar\n\nbar');
    expect(result.nextBody).toContain('## Sources');
    expect(result.changed).toBe(true);
  });

  it('returns section_not_found when section missing', () => {
    const result = applyMarkdownPatch({
      currentBody: original,
      patch: { kind: 'replace_section', section: 'Missing', body: 'x' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('section_not_found');
  });
});

describe('applyMarkdownPatch — append', () => {
  const original = '---\nt: x\n---\n\n# Top\n\nintro\n\n## Sources\n\n- [[s]]';

  it('append { section: null } appends to end before sources', () => {
    const result = applyMarkdownPatch({
      currentBody: original,
      patch: { kind: 'append', section: null, body: 'new tail' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextBody.indexOf('new tail')).toBeLessThan(result.nextBody.indexOf('## Sources'));
    expect(result.nextBody).toContain('## Sources');
  });

  it('append { section } returns section_not_found when missing', () => {
    const result = applyMarkdownPatch({
      currentBody: original,
      patch: { kind: 'append', section: 'Foo', body: 'x' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('section_not_found');
  });

  it('append { section } inserts inside the section before next sibling', () => {
    const original2 = '# Top\n\n## Foo\n\nfoo\n\n## Bar\n\nbar\n\n## Sources\n\n- [[s]]';
    const result = applyMarkdownPatch({
      currentBody: original2,
      patch: { kind: 'append', section: 'Foo', body: 'foo extra' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextBody).toMatch(/## Foo[\s\S]*foo extra[\s\S]*## Bar/);
  });
});

describe('applyMarkdownPatch — delete', () => {
  it('removes a named section', () => {
    const input = '# Top\n\n## Foo\n\nfoo\n\n## Bar\n\nbar';
    const result = applyMarkdownPatch({
      currentBody: input,
      patch: { kind: 'delete', section: 'Foo' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextBody).not.toContain('## Foo');
    expect(result.nextBody).toContain('## Bar');
  });

  it('refuses delete with section: null (whole-body wipe)', () => {
    const result = applyMarkdownPatch({
      currentBody: '# x\n\nbody',
      patch: { kind: 'delete', section: null },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported_kind');
  });
});

describe('applyMarkdownPatch — create-source-summary', () => {
  it('returns unsupported_kind here (handled elsewhere)', () => {
    const result = applyMarkdownPatch({
      currentBody: '# x',
      patch: { kind: 'create-source-summary', rawPath: 'wiki/raw/x.md', body: 'sum' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported_kind');
  });
});

describe('applyMarkdownPatch — idempotent no-op', () => {
  it('returns changed=false when patch yields identical body', () => {
    const input = '# Top\n\n## Foo\n\nfoo body\n';
    const result = applyMarkdownPatch({
      currentBody: input,
      patch: { kind: 'replace_section', section: 'Foo', body: 'foo body' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
  });
});
