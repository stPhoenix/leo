import { z } from 'zod';

export const LINT_SEVERITIES = ['info', 'warn', 'error'] as const;
export type LintSeverity = (typeof LINT_SEVERITIES)[number];

export const LINT_CONCERNS = [
  'contradiction',
  'stale',
  'orphan-page',
  'orphan-raw',
  'missing-page',
  'missing-xref',
  'research-gap',
  'schema-drift',
] as const;
export type LintConcern = (typeof LINT_CONCERNS)[number];

const PatchSchema = z.union([
  z.object({
    kind: z.literal('append'),
    section: z.string().nullable().default(null),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('replace_section'),
    section: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('replace_body'),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('delete'),
    section: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal('create-source-summary'),
    rawPath: z.string(),
    body: z.string(),
  }),
]);

export const LintFindingSchema = z.object({
  id: z.string().min(1),
  concern: z.enum(LINT_CONCERNS),
  severity: z.enum(LINT_SEVERITIES),
  page: z.string().nullable().default(null),
  rawPath: z.string().nullable().default(null),
  rationale: z.string().min(1),
  patch: PatchSchema.nullable().default(null),
  suggestedQueries: z.array(z.string()).default([]),
  note: z.string().max(2000).optional(),
});
export type LintFinding = z.infer<typeof LintFindingSchema>;
export type LintFindingPatch = NonNullable<LintFinding['patch']>;
export const LintFindingPatchSchema = PatchSchema;

export const LintFindingsArraySchema = z.array(LintFindingSchema);

/**
 * Provider-agnostic envelope. Anthropic rejects tool input_schemas whose
 * top-level isn't `{type: 'object'}`; OpenAI accepts both. Wrap arrays/unions
 * in an object so the same wire shape works across all providers.
 */
export const LintFindingsEnvelopeSchema = z.object({
  findings: LintFindingsArraySchema,
});
export const LintFindingPatchEnvelopeSchema = z.object({
  patch: PatchSchema,
});

export const OrphanPageLinkProposalSchema = z.object({
  targetPage: z.string().min(1),
  linkText: z.string().min(1).max(500),
  section: z.string().nullable().optional().default('See also'),
});
export type OrphanPageLinkProposal = z.infer<typeof OrphanPageLinkProposalSchema>;

export const OrphanPageLinkProposalEnvelopeSchema = z.object({
  proposal: OrphanPageLinkProposalSchema,
});

export const LintSchemaPatchSchema = z.object({
  rationale: z.string().min(1),
  patch: z.object({
    kind: z.enum(['append', 'replace_section', 'replace_body']),
    section: z.string().nullable().default(null),
    body: z.string(),
  }),
});
export type LintSchemaPatch = z.infer<typeof LintSchemaPatchSchema>;
