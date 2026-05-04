import { z } from 'zod';

export const fetchUrlInputSchema = z
  .object({
    url: z.string().describe('Absolute http: or https: URL.'),
    method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method.'),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe('Optional request headers. Authorization-style keys are redacted in logs.'),
    body: z.string().optional().describe('Request body (POST only).'),
    responseFormat: z
      .enum(['text', 'json'])
      .default('text')
      .describe("Parse response body as 'text' (default) or 'json'."),
  })
  .strict();

export type FetchUrlInput = z.infer<typeof fetchUrlInputSchema>;

export const searchWebInputSchema = z
  .object({
    query: z.string().min(1).max(400).describe('Search query (1–400 chars).'),
    maxResults: z.number().int().min(1).max(20).optional().describe('Max result count (1–20).'),
    searchDepth: z.enum(['basic', 'advanced']).optional(),
    topic: z.enum(['general', 'news']).optional(),
    includeAnswer: z.boolean().optional(),
    includeDomains: z.array(z.string()).max(32).optional(),
    excludeDomains: z.array(z.string()).max(32).optional(),
  })
  .strict();

export type SearchWebInput = z.infer<typeof searchWebInputSchema>;

export const readFileInputSchema = z
  .object({
    relPath: z.string().describe('Path relative to the sandbox root.'),
    offset: z.number().int().min(0).optional().describe('Byte offset (default 0).'),
    limit: z.number().int().min(1).optional().describe('Max bytes to read.'),
  })
  .strict();
export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export const writeFileInputSchema = z
  .object({
    relPath: z.string(),
    content: z.string(),
    encoding: z.enum(['utf-8', 'base64']).optional(),
  })
  .strict();
export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

export const listDirInputSchema = z
  .object({
    relPath: z.string().optional(),
  })
  .strict();
export type ListDirInput = z.infer<typeof listDirInputSchema>;

export const deleteFileInputSchema = z
  .object({
    relPath: z.string(),
  })
  .strict();
export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;

export const appendFileInputSchema = z
  .object({
    relPath: z.string().describe('Path relative to the sandbox root.'),
    content: z.string().describe('Content to append. Caller adds any trailing newline.'),
    encoding: z.enum(['utf-8', 'base64']).optional().describe("Default 'utf-8'."),
  })
  .strict();
export type AppendFileInput = z.infer<typeof appendFileInputSchema>;

export const GREP_DEFAULT_MAX_MATCHES = 200;

export const grepInputSchema = z
  .object({
    pattern: z
      .string()
      .min(1)
      .max(2_000)
      .describe('Substring (default) or JavaScript regex when regex=true.'),
    relPath: z
      .string()
      .optional()
      .describe('Relative directory or file under the sandbox. Default: sandbox root.'),
    regex: z.boolean().optional().describe('Treat pattern as a JS regex. Default false.'),
    ignoreCase: z.boolean().optional().describe('Case-insensitive match. Default false.'),
    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(2_000)
      .optional()
      .describe(`Cap match count (default ${GREP_DEFAULT_MAX_MATCHES}).`),
  })
  .strict();
export type GrepInput = z.infer<typeof grepInputSchema>;

export const downloadToFileInputSchema = z
  .object({
    url: z.string().describe('Absolute http: or https: URL.'),
    relPath: z.string().describe('Sandbox path (relative to root) to save the body to.'),
    method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method.'),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional().describe('Request body (POST only).'),
  })
  .strict();
export type DownloadToFileInput = z.infer<typeof downloadToFileInputSchema>;

export const GLOB_DEFAULT_MAX_RESULTS = 500;

export const globInputSchema = z
  .object({
    pattern: z
      .string()
      .min(1)
      .max(500)
      .describe('Glob pattern relative to sandbox root (e.g. "**/*.md", "canon/**").'),
    maxResults: z.number().int().min(1).max(5_000).optional(),
  })
  .strict();
export type GlobInput = z.infer<typeof globInputSchema>;

export const publishArtifactInputSchema = z
  .object({
    relPath: z.string(),
    summary: z.string().max(2_000).optional(),
  })
  .strict();
export type PublishArtifactInput = z.infer<typeof publishArtifactInputSchema>;

export const extractNoteInputSchema = z
  .object({
    sourceUrl: z.string().optional(),
    title: z.string().min(1).max(200),
    summary: z.string().min(1),
    relevance: z.number().min(0).max(1),
  })
  .strict();
export type ExtractNoteInput = z.infer<typeof extractNoteInputSchema>;

export const classifyTaskOutputSchema = z
  .object({
    route: z.enum(['simple', 'multistep']),
    reasoning: z.string(),
    initialPlan: z.array(z.string()).optional(),
  })
  .strict();
export type ClassifyTaskOutput = z.infer<typeof classifyTaskOutputSchema>;

export const TODO_MAX_ITEMS = 64;

export const todoWriteInputSchema = z
  .object({
    todos: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            content: z.string().min(1).max(500),
            status: z.enum(['pending', 'in_progress', 'completed']),
          })
          .strict(),
      )
      .max(TODO_MAX_ITEMS),
  })
  .strict();
export type TodoWriteInput = z.infer<typeof todoWriteInputSchema>;

export const plannerOutputSchema = z
  .object({
    plan: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
