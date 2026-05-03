import { describe, expect, it, vi } from 'vitest';
import { runCheckers, runProposing } from '@/agent/wiki/lint/checkers';
import type { LintScanResult } from '@/agent/wiki/lint/scan';
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
      { invoke: fixedInvoker([[]]) },
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
      { invoke: fixedInvoker([[]]) },
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
      { invoke: fixedInvoker([valid]) },
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
      { invoke: fixedInvoker([violating]) },
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
