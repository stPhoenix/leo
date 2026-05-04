import type { ZodType } from 'zod';
import type { Logger } from '@/platform/Logger';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';
import { WIKI_BUDGETS, type WikiBudgets } from '@/agent/wiki/budgets';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import {
  ExtractorOutputSchema,
  PlannerOutputSchema,
  ReducerOutputSchema,
  type ExtractorOutput,
  type PlannerOutput,
  type ReducerOutput,
} from './schemas';

export interface LlmJsonInvoker {
  invoke<T>(
    input: { readonly system: string; readonly user: string },
    schema: ZodType<T>,
    name: string,
    signal: AbortSignal,
  ): Promise<T>;
}

export interface PlannerInput {
  readonly ingestId: string;
  readonly schemaMd: string;
  readonly indexExcerpt: string;
  readonly perSource: readonly {
    readonly rawPath: string;
    readonly frontmatterText: string;
    readonly bodyHead: string;
  }[];
}

export interface PlannerDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

export type SubagentResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

const PLANNER_SYSTEM = `You are the planner step of a wiki-ingest pipeline. Read SCHEMA.md, the index excerpt, and per-source previews. Pick candidate page slugs (kebab-case, relative to wiki/pages/) for each source.`;

export async function runPlanner(
  input: PlannerInput,
  deps: PlannerDeps,
  signal: AbortSignal,
): Promise<SubagentResult<PlannerOutput>> {
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const userPrompt = buildPlannerUserPrompt(input, budgets);
  const result = await invokeStructured({
    invoke: deps.invoke,
    schema: PlannerOutputSchema,
    name: 'wiki_planner',
    system: PLANNER_SYSTEM,
    user: userPrompt,
    inputCap: budgets.plannerInputCap,
    signal,
    logger: deps.logger,
  });
  if (!result.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.plan.invalid, { error: result.error });
  }
  return result;
}

function buildPlannerUserPrompt(input: PlannerInput, budgets: WikiBudgets): string {
  const lines: string[] = [];
  lines.push(`# Ingest plan request — ${input.ingestId}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(truncateForCap(input.schemaMd, budgets.plannerInputCap / 4));
  lines.push('');
  lines.push('## index.md (top excerpt)');
  lines.push(truncateForCap(input.indexExcerpt, budgets.plannerInputCap / 4));
  lines.push('');
  lines.push('## Sources');
  for (const s of input.perSource) {
    lines.push(`### ${s.rawPath}`);
    lines.push('Frontmatter:');
    lines.push(s.frontmatterText);
    lines.push('Body head:');
    lines.push(truncateForCap(s.bodyHead, 2000));
    lines.push('');
  }
  return lines.join('\n');
}

export interface ExtractorInput {
  readonly rawPath: string;
  readonly rawBody: string;
  readonly schemaMd: string;
  readonly candidatePages: readonly string[];
  readonly indexExcerpt: string;
}

export interface ExtractorDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

const EXTRACTOR_SYSTEM = `You are the extractor step of the wiki-ingest pipeline. Read the raw entry, SCHEMA.md, the candidate page list, and the matching index excerpts. For each page op:
- Body must NOT contain a YAML frontmatter block (no leading or embedded "---" delimiters). Frontmatter goes in the per-op fields (tags, aliases) only.
- Body must NOT contain a "## Sources" section, source citations list, or "Sources" heading. Source links go in the per-op "sources" array only.
- Start with the page's "# Title" heading, then synthesis prose with [[wikilink]] cross-references woven INLINE inside sentences.
- Do NOT emit a bare-line list of [[wikilinks]] at the end of the body. Bad: end with "[[the-covenant]]\\n[[sacred-bond]]". Good: "the [[the-covenant]] elaborates the [[sacred-bond]] between minds."`;

export async function runExtractor(
  input: ExtractorInput,
  deps: ExtractorDeps,
  signal: AbortSignal,
): Promise<SubagentResult<ExtractorOutput>> {
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const userPrompt = buildExtractorUserPrompt(input, budgets);
  const result = await invokeStructured({
    invoke: deps.invoke,
    schema: ExtractorOutputSchema,
    name: 'wiki_extractor',
    system: EXTRACTOR_SYSTEM,
    user: userPrompt,
    inputCap: budgets.extractorInputCap,
    signal,
    logger: deps.logger,
    errorCode: 'extract_invalid',
  });
  if (!result.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.extract.invalid, { rawPath: input.rawPath });
  } else {
    deps.logger?.debug(WIKI_LOG.ingest.extract.ok, {
      rawPath: input.rawPath,
      pageOps: result.data.pageOps.length,
    });
  }
  return result;
}

function buildExtractorUserPrompt(input: ExtractorInput, budgets: WikiBudgets): string {
  const lines: string[] = [];
  lines.push(`# Extract from ${input.rawPath}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(truncateForCap(input.schemaMd, budgets.extractorInputCap / 4));
  lines.push('');
  lines.push('## Candidate pages');
  lines.push(input.candidatePages.join(', '));
  lines.push('');
  lines.push('## Index excerpts');
  lines.push(truncateForCap(input.indexExcerpt, 1500));
  lines.push('');
  lines.push('## Raw body');
  lines.push(truncateForCap(input.rawBody, Math.max(2000, budgets.extractorInputCap - 1500)));
  return lines.join('\n');
}

export interface ReducerInput {
  readonly pageSlug: string;
  readonly currentBody: string | null;
  readonly schemaMd: string;
  readonly pageOps: readonly unknown[];
}

export interface ReducerDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

const REDUCER_SYSTEM = `You are the reducer step of the wiki-ingest pipeline. Merge all page operations targeting one page into a coherent edit that fits SCHEMA.md.
Hard rules for "body":
- MUST NOT contain a YAML frontmatter block (no leading or embedded "---" delimiters). Frontmatter goes in the "frontmatter" field only.
- MUST NOT contain a "## Sources" section, source citations list, or "Sources" heading. Source links go in the "sources" array only — the writer renders them.
- Start with the page's "# Title" heading, then synthesis prose with [[wikilink]] cross-references woven INLINE inside sentences.
- DO NOT emit a bare-line list of [[wikilinks]] at the end of the body. Bad: end with "[[the-covenant]]\\n[[sacred-bond]]". Good: "The [[the-covenant]] elaborates the [[sacred-bond]] between minds."
Hard rules for "sources":
- Each entry MUST be a bare slug or path string — NO surrounding "[[...]]" brackets. The writer adds wikilink syntax. Example: "sources/20260501-foo" not "[[sources/20260501-foo]]".
Preserve user-authored content where compatible with SCHEMA.`;

export async function runReducer(
  input: ReducerInput,
  deps: ReducerDeps,
  signal: AbortSignal,
): Promise<SubagentResult<ReducerOutput>> {
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const userPrompt = buildReducerUserPrompt(input, budgets);
  const result = await invokeStructured({
    invoke: deps.invoke,
    schema: ReducerOutputSchema,
    name: 'wiki_reducer',
    system: REDUCER_SYSTEM,
    user: userPrompt,
    inputCap: budgets.reducerInputCap,
    signal,
    logger: deps.logger,
    errorCode: 'reduce_invalid',
  });
  if (!result.ok) {
    deps.logger?.debug(WIKI_LOG.ingest.reduce.invalid, { pageSlug: input.pageSlug });
  } else {
    deps.logger?.debug(WIKI_LOG.ingest.reduce.ok, {
      pageSlug: input.pageSlug,
      action: result.data.action,
    });
  }
  return result;
}

function buildReducerUserPrompt(input: ReducerInput, budgets: WikiBudgets): string {
  const lines: string[] = [];
  lines.push(`# Reduce page ${input.pageSlug}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(truncateForCap(input.schemaMd, budgets.reducerInputCap / 4));
  lines.push('');
  lines.push('## Current body');
  lines.push(input.currentBody === null ? '(none — create new page)' : input.currentBody);
  lines.push('');
  lines.push('## Page operations to merge');
  lines.push(JSON.stringify(input.pageOps, null, 2));
  return lines.join('\n');
}

interface InvokeStructuredArgs<T> {
  readonly invoke: LlmJsonInvoker;
  readonly schema: ZodType<T>;
  readonly name: string;
  readonly system: string;
  readonly user: string;
  readonly inputCap: number;
  readonly signal: AbortSignal;
  readonly logger?: Logger;
  readonly errorCode?: string;
}

async function invokeStructured<T>(args: InvokeStructuredArgs<T>): Promise<SubagentResult<T>> {
  if (args.signal.aborted) return { ok: false, error: 'aborted' };
  const inputTokens = roughTokenCountEstimation(args.user) + roughTokenCountEstimation(args.system);
  const userPrompt =
    inputTokens > args.inputCap ? truncateForCap(args.user, args.inputCap * 4) : args.user;
  try {
    const data = await args.invoke.invoke(
      { system: args.system, user: userPrompt },
      args.schema,
      args.name,
      args.signal,
    );
    return { ok: true, data };
  } catch (err) {
    if (args.signal.aborted) return { ok: false, error: 'aborted' };
    const message = err instanceof Error ? err.message : String(err);
    args.logger?.debug(WIKI_LOG.ingest.extract.retry, { error: message });
    return { ok: false, error: args.errorCode ?? message };
  }
}

function truncateForCap(text: string, charCap: number): string {
  if (text.length <= charCap) return text;
  return `${text.slice(0, charCap)}…`;
}
