import { z } from 'zod';

export const PageOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create'),
    slug: z.string().min(1),
    title: z.string().min(1),
    body: z.string(),
    aliases: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    sources: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal('edit'),
    slug: z.string().min(1),
    section: z.string().nullable().default(null),
    patch: z.enum(['append', 'replace_section', 'replace_body']),
    body: z.string(),
    sources: z.array(z.string()).default([]),
  }),
]);
export type PageOp = z.infer<typeof PageOpSchema>;

export const ExtractorOutputSchema = z.object({
  rawPath: z.string().min(1),
  pageOps: z.array(PageOpSchema),
});
export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>;

export const ReducerOutputSchema = z.object({
  pageSlug: z.string().min(1),
  action: z.enum(['create', 'edit', 'noop']),
  body: z.string(),
  frontmatter: z
    .object({
      tags: z.array(z.string()).default([]),
      last_updated: z.string().default(''),
      source_count: z.number().int().nonnegative().default(0),
    })
    .catchall(z.unknown()),
  sources: z.array(z.string()).default([]),
});
export type ReducerOutput = z.infer<typeof ReducerOutputSchema>;

export const PlannerOutputSchema = z.object({
  ingestId: z.string().min(1),
  perSource: z.array(
    z.object({
      rawPath: z.string().min(1),
      candidatePages: z.array(z.string()),
    }),
  ),
});
export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
