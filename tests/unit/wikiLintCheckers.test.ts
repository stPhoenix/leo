import { describe, expect, it, vi } from 'vitest';
import {
  runCheckers,
  runProposing,
  tryProposeFindingPatch,
  tryProposeOrphanPageLink,
} from '@/agent/wiki/lint/checkers';
import type { LintScanResult, PageNode } from '@/agent/wiki/lint/scan';
import type { LintFinding } from '@/agent/wiki/lint/schemas';
import type { ZodType } from 'zod';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';

function makeScan(overrides: Partial<LintScanResult> = {}): LintScanResult {
  return {
    pages: [],
    sources: [],
    rawPaths: [],
    adjacency: new Map(),
    inboundCount: new Map(),
    orphanPages: [],
    orphanRawPaths: [],
    schemaMd: '# schema',
    ...overrides,
  };
}

function fixedInvoker(responses: readonly unknown[]): LlmJsonInvoker {
  let i = 0;
  return {
    async invoke<T>(
      _input: { system: string; user: string },
      schema: ZodType<T>,
      _name: string,
      _signal: AbortSignal,
    ): Promise<T> {
      const value = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return schema.parse(value);
    },
  };
}

describe('runCheckers — pure concerns', () => {
  it('orphan-page produces one finding per scan.orphanPages', async () => {
    const scan = makeScan({
      orphanPages: ['wiki/pages/a.md', 'wiki/pages/b.md'],
    });
    const result = await runCheckers(
      scan,
      ['orphan-page'],
      { invoke: fixedInvoker([{ findings: [] }]) },
      new AbortController().signal,
    );
    expect(result.findings.length).toBe(2);
    expect(result.findings[0]?.concern).toBe('orphan-page');
    expect(result.findings[0]?.severity).toBe('warn');
    expect(result.findings[0]?.patch).toBeNull();
  });

  it('orphan-raw produces findings with rawPath set, page null', async () => {
    const scan = makeScan({ orphanRawPaths: ['wiki/raw/x.md'] });
    const result = await runCheckers(
      scan,
      ['orphan-raw'],
      { invoke: fixedInvoker([{ findings: [] }]) },
      new AbortController().signal,
    );
    expect(result.findings[0]?.rawPath).toBe('wiki/raw/x.md');
    expect(result.findings[0]?.page).toBeNull();
  });
});

describe('runCheckers — LLM concerns', () => {
  it('contradiction parses valid LintFinding[] response', async () => {
    const valid = [
      {
        id: 'c1',
        concern: 'contradiction',
        severity: 'warn',
        page: 'wiki/pages/a.md',
        rawPath: null,
        rationale: 'Page A claims X but page B claims not X',
        patch: null,
        suggestedQueries: [],
      },
    ];
    const result = await runCheckers(
      makeScan(),
      ['contradiction'],
      { invoke: fixedInvoker([{ findings: valid }]) },
      new AbortController().signal,
    );
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.concern).toBe('contradiction');
  });

  it('research-gap stamps severity:info + patch:null even if LLM says otherwise', async () => {
    const violating = [
      {
        id: 'r1',
        concern: 'research-gap',
        severity: 'error',
        page: 'wiki/pages/x.md',
        rawPath: null,
        rationale: 'thin',
        patch: { kind: 'append', section: null, body: 'ignore me' },
        suggestedQueries: ['more sources for x'],
      },
    ];
    const result = await runCheckers(
      makeScan(),
      ['research-gap'],
      { invoke: fixedInvoker([{ findings: violating }]) },
      new AbortController().signal,
    );
    expect(result.findings[0]?.severity).toBe('info');
    expect(result.findings[0]?.patch).toBeNull();
    expect(result.findings[0]?.suggestedQueries).toEqual(['more sources for x']);
  });

  it('marks check_invalid when LLM response fails schema validation', async () => {
    const result = await runCheckers(
      makeScan(),
      ['stale'],
      { invoke: fixedInvoker([{}]) },
      new AbortController().signal,
    );
    expect(result.findings.length).toBe(0);
    expect(result.perConcern['stale']?.ok).toBe(false);
  });

  it('passes pre-aborted signal through; never invokes LLM', async () => {
    const ac = new AbortController();
    ac.abort();
    const innerInvoke = vi.fn(async () => []);
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    await runCheckers(makeScan(), ['contradiction'], { invoke: invoker }, ac.signal);
    expect(innerInvoke).not.toHaveBeenCalled();
  });
});

describe('runProposing', () => {
  it('ranks findings by severity (error → warn → info), then by id', async () => {
    const findings: LintFinding[] = [
      {
        id: 'b',
        concern: 'orphan-page',
        severity: 'warn',
        page: 'p',
        rawPath: null,
        rationale: 'r',
        patch: null,
        suggestedQueries: [],
      },
      {
        id: 'a',
        concern: 'research-gap',
        severity: 'info',
        page: 'p',
        rawPath: null,
        rationale: 'r',
        patch: null,
        suggestedQueries: [],
      },
      {
        id: 'c',
        concern: 'contradiction',
        severity: 'error',
        page: 'p',
        rawPath: null,
        rationale: 'r',
        patch: null,
        suggestedQueries: [],
      },
    ];
    const result = await runProposing(findings, makeScan(), {}, new AbortController().signal);
    expect(result.findings.map((f) => f.id)).toEqual(['c', 'b', 'a']);
  });

  it('schemaPatch separated from inline page edits', async () => {
    const findings: LintFinding[] = [
      {
        id: 's1',
        concern: 'schema-drift',
        severity: 'info',
        page: 'wiki/SCHEMA.md',
        rawPath: null,
        rationale: 'tags array form deprecated',
        patch: {
          kind: 'append',
          section: null,
          body: 'whatever — should be stripped from inline output',
        },
        suggestedQueries: [],
      },
    ];
    const validSchemaPatch = {
      rationale: 'Migrate tags array form',
      patch: { kind: 'append', section: null, body: '## New rule' },
    };
    const result = await runProposing(
      findings,
      makeScan(),
      { invoke: fixedInvoker([validSchemaPatch]) },
      new AbortController().signal,
    );
    expect(result.schemaPatch).not.toBeNull();
    expect(result.findings[0]?.patch).toBeNull();
  });
});

describe('tryProposeFindingPatch', () => {
  function baseFinding(overrides: Partial<LintFinding> = {}): LintFinding {
    return {
      id: 'f1',
      concern: 'contradiction',
      severity: 'warn',
      page: 'wiki/pages/a.md',
      rawPath: null,
      rationale: 'r',
      patch: null,
      suggestedQueries: [],
      ...overrides,
    };
  }

  it('happy path returns ok with parsed patch', async () => {
    const validPatch = {
      kind: 'replace_section',
      section: 'Notes',
      body: 'fixed claim',
    };
    const result = await tryProposeFindingPatch(
      { finding: baseFinding(), scan: makeScan(), pageBody: '# A\n\n## Notes\nold' },
      { invoke: fixedInvoker([{ patch: validPatch }]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.kind).toBe('replace_section');
  });

  it('research-gap is skipped without invoking LLM', async () => {
    const innerInvoke = vi.fn(async () => ({ kind: 'append', section: null, body: 'x' }));
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const result = await tryProposeFindingPatch(
      {
        finding: baseFinding({ concern: 'research-gap', severity: 'info' }),
        scan: makeScan(),
        pageBody: 'x',
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('skipped');
    expect(innerInvoke).not.toHaveBeenCalled();
  });

  it('schema-drift is skipped (handled by SCHEMA panel)', async () => {
    const innerInvoke = vi.fn(async () => ({}));
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const result = await tryProposeFindingPatch(
      { finding: baseFinding({ concern: 'schema-drift' }), scan: makeScan(), pageBody: 'x' },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('skipped');
    expect(innerInvoke).not.toHaveBeenCalled();
  });

  it('orphan-page is skipped here (handled by tryProposeOrphanPageLink)', async () => {
    const innerInvoke = vi.fn();
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const result = await tryProposeFindingPatch(
      { finding: baseFinding({ concern: 'orphan-page' }), scan: makeScan(), pageBody: null },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('skipped');
    expect(innerInvoke).not.toHaveBeenCalled();
  });

  it('orphan-raw without rawPath returns no_page', async () => {
    const result = await tryProposeFindingPatch(
      {
        finding: baseFinding({
          concern: 'orphan-raw',
          page: null,
          rawPath: null,
        }),
        scan: makeScan(),
        pageBody: null,
      },
      { invoke: fixedInvoker([]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_page');
  });

  it('rejects mismatched patch kind (e.g. create-source-summary for stale concern)', async () => {
    const result = await tryProposeFindingPatch(
      { finding: baseFinding({ concern: 'stale' }), scan: makeScan(), pageBody: 'body' },
      {
        invoke: fixedInvoker([
          { patch: { kind: 'create-source-summary', rawPath: 'wiki/raw/x.md', body: 'b' } },
        ]),
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
    expect(result.message).toContain('not allowed for concern "stale"');
  });

  it('orphan-raw with rawPath asks LLM and returns create-source-summary', async () => {
    const validPatch = {
      kind: 'create-source-summary',
      rawPath: 'wiki/raw/x.md',
      body: 'summary',
    };
    const result = await tryProposeFindingPatch(
      {
        finding: baseFinding({
          concern: 'orphan-raw',
          page: null,
          rawPath: 'wiki/raw/x.md',
        }),
        scan: makeScan(),
        pageBody: null,
      },
      { invoke: fixedInvoker([{ patch: validPatch }]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patch.kind).toBe('create-source-summary');
  });

  it('aborted signal short-circuits without invoking LLM', async () => {
    const ac = new AbortController();
    ac.abort();
    const innerInvoke = vi.fn();
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const result = await tryProposeFindingPatch(
      { finding: baseFinding(), scan: makeScan(), pageBody: 'x' },
      { invoke: invoker },
      ac.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('aborted');
    expect(innerInvoke).not.toHaveBeenCalled();
  });

  it('invalid LLM JSON returns invalid', async () => {
    const result = await tryProposeFindingPatch(
      { finding: baseFinding(), scan: makeScan(), pageBody: 'x' },
      { invoke: fixedInvoker([{ patch: { kind: 'unknown' } }]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid');
  });

  it('user note appears verbatim in user prompt', async () => {
    const captured: string[] = [];
    const invoker: LlmJsonInvoker = {
      async invoke<T>(
        input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        captured.push(input.user);
        return schema.parse({ patch: { kind: 'append', section: null, body: 'x' } });
      },
    };
    await tryProposeFindingPatch(
      {
        finding: baseFinding(),
        scan: makeScan(),
        pageBody: 'body',
        note: 'use canonical wikilink [[b]]',
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(captured[0]).toContain('use canonical wikilink [[b]]');
    expect(captured[0]).toContain('User note');
  });
});

describe('tryProposeOrphanPageLink', () => {
  function page(path: string, title: string, tags: readonly string[] = []): PageNode {
    return {
      path,
      slug: path.replace(/^wiki\/pages\//, '').replace(/\.md$/, ''),
      title,
      tags,
      outbound: [],
    };
  }
  function scanWithPages(pages: readonly PageNode[]): LintScanResult {
    return {
      pages: [...pages],
      sources: [],
      rawPaths: [],
      adjacency: new Map(),
      inboundCount: new Map(),
      orphanPages: [],
      orphanRawPaths: [],
      schemaMd: '',
    };
  }
  function orphanFinding(path: string): LintFinding {
    return {
      id: `orphan-page-0-${path}`,
      concern: 'orphan-page',
      severity: 'warn',
      page: path,
      rawPath: null,
      rationale: 'no inbound wikilinks',
      patch: null,
      suggestedQueries: [],
    };
  }

  it('happy path returns proposal targeting an existing other page', async () => {
    const orphan = 'wiki/pages/orphan.md';
    const target = 'wiki/pages/related.md';
    const scan = scanWithPages([page(orphan, 'Orphan'), page(target, 'Related')]);
    const llmResponse = {
      proposal: { targetPage: target, linkText: '- [[orphan|Orphan]]', section: 'See also' },
    };
    const result = await tryProposeOrphanPageLink(
      { finding: orphanFinding(orphan), scan, orphanBody: '# Orphan\n\nbody' },
      { invoke: fixedInvoker([llmResponse]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.targetPage).toBe(target);
    expect(result.proposal.section).toBe('See also');
  });

  it('rejects targetPage that does not exist in candidate index', async () => {
    const orphan = 'wiki/pages/orphan.md';
    const scan = scanWithPages([page(orphan, 'Orphan'), page('wiki/pages/a.md', 'A')]);
    const llmResponse = {
      proposal: { targetPage: 'wiki/pages/ghost.md', linkText: '- [[orphan]]', section: null },
    };
    const result = await tryProposeOrphanPageLink(
      { finding: orphanFinding(orphan), scan, orphanBody: null },
      { invoke: fixedInvoker([llmResponse]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_target');
  });

  it('rejects targetPage equal to orphan itself', async () => {
    const orphan = 'wiki/pages/orphan.md';
    const scan = scanWithPages([page(orphan, 'Orphan'), page('wiki/pages/a.md', 'A')]);
    const llmResponse = {
      proposal: { targetPage: orphan, linkText: '- [[orphan]]', section: null },
    };
    const result = await tryProposeOrphanPageLink(
      { finding: orphanFinding(orphan), scan, orphanBody: null },
      { invoke: fixedInvoker([llmResponse]) },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_target');
  });

  it('returns no_candidates when only the orphan exists', async () => {
    const orphan = 'wiki/pages/orphan.md';
    const scan = scanWithPages([page(orphan, 'Orphan')]);
    const innerInvoke = vi.fn();
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const result = await tryProposeOrphanPageLink(
      { finding: orphanFinding(orphan), scan, orphanBody: null },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_candidates');
    expect(innerInvoke).not.toHaveBeenCalled();
  });

  it('aborted signal short-circuits', async () => {
    const orphan = 'wiki/pages/orphan.md';
    const scan = scanWithPages([page(orphan, 'Orphan'), page('wiki/pages/a.md', 'A')]);
    const ac = new AbortController();
    ac.abort();
    const innerInvoke = vi.fn();
    const invoker: LlmJsonInvoker = {
      invoke: innerInvoke as unknown as LlmJsonInvoker['invoke'],
    };
    const result = await tryProposeOrphanPageLink(
      { finding: orphanFinding(orphan), scan, orphanBody: null },
      { invoke: invoker },
      ac.signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('aborted');
    expect(innerInvoke).not.toHaveBeenCalled();
  });

  it('candidate list and user note appear in user prompt', async () => {
    const orphan = 'wiki/pages/orphan.md';
    const target = 'wiki/pages/related.md';
    const scan = scanWithPages([page(orphan, 'Orphan'), page(target, 'Related', ['t1'])]);
    const captured: string[] = [];
    const invoker: LlmJsonInvoker = {
      async invoke<T>(
        input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        captured.push(input.user);
        return schema.parse({
          proposal: { targetPage: target, linkText: '- [[orphan]]', section: 'See also' },
        });
      },
    };
    await tryProposeOrphanPageLink(
      {
        finding: orphanFinding(orphan),
        scan,
        orphanBody: 'orphan body',
        note: 'prefer the page about related stuff',
      },
      { invoke: invoker },
      new AbortController().signal,
    );
    expect(captured[0]).toContain(target);
    expect(captured[0]).toContain('Related');
    expect(captured[0]).toContain('[t1]');
    expect(captured[0]).toContain('prefer the page about related stuff');
  });
});
