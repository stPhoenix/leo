import { z } from 'zod';

export const DEFAULT_FETCH_URL_BLOCKLIST: readonly string[] = [
  'localhost',
  '127.0.0.0/8',
  '0.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '169.254.0.0/16',
  '*.local',
  '::1',
  'fc00::/7',
  'fe80::/10',
  '::ffff:0:0/96',
  '64:ff9b::/96',
];

export const DEFAULT_FETCH_URL_HEADER_DENYLIST: readonly string[] = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
];

const fetchUrlSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Enable fetch_url tool'),
    allowlist: z
      .array(z.string())
      .default([])
      .describe('Glob host patterns. When non-empty, only matching hosts are reachable.'),
    blocklist: z
      .array(z.string())
      .default([...DEFAULT_FETCH_URL_BLOCKLIST])
      .describe('Glob host patterns blocked even when allowlist matches.'),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000)
      .describe('Per-call timeout in ms. Default 30 s.'),
    maxBytes: z
      .number()
      .int()
      .min(1_024)
      .max(50 * 1024 * 1024)
      .default(5 * 1024 * 1024)
      .describe('Body cap in bytes. Default 5 MB.'),
    requireDnsResolveCheck: z
      .boolean()
      .default(true)
      .describe(
        'Resolve hostname before fetch and reject if it points at a private/loopback/link-local IP. Defends against DNS-rebind / SSRF.',
      ),
    headerDenylist: z
      .array(z.string())
      .default([...DEFAULT_FETCH_URL_HEADER_DENYLIST])
      .describe(
        'Outbound request headers stripped before fetch (case-insensitive). Defaults strip credentials so the model cannot exfiltrate them via crafted URLs.',
      ),
  })
  .describe('fetch_url HTTP/HTTPS tool config');

const searchWebSchema = z
  .object({
    enabled: z.boolean().default(true).describe('Enable Tavily search_web tool'),
    apiKeyRef: z
      .string()
      .default('safeStorage:externalAgents.inline-agent.tavilyApiKey')
      .describe('secret'),
    defaultMaxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe('Default Tavily maxResults when the model does not specify.'),
    defaultSearchDepth: z.enum(['basic', 'advanced']).default('basic'),
    defaultTopic: z.enum(['general', 'news']).default('general'),
    includeAnswer: z
      .boolean()
      .default(true)
      .describe('Include Tavily one-line answer alongside results.'),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(20_000),
    maxBytes: z
      .number()
      .int()
      .min(1_024)
      .max(2 * 1024 * 1024)
      .default(256 * 1024),
  })
  .describe('search_web (Tavily) tool config');

const fileOpsSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe('Enable read_file/write_file/list_dir/delete_file sandbox tools.'),
  })
  .describe('Sandbox file ops config');

const toolsSchema = z
  .object({
    fetchUrl: fetchUrlSchema.default({
      enabled: true,
      allowlist: [],
      blocklist: [...DEFAULT_FETCH_URL_BLOCKLIST],
      timeoutMs: 30_000,
      maxBytes: 5 * 1024 * 1024,
      requireDnsResolveCheck: true,
      headerDenylist: [...DEFAULT_FETCH_URL_HEADER_DENYLIST],
    }),
    searchWeb: searchWebSchema.default({
      enabled: true,
      apiKeyRef: 'safeStorage:externalAgents.inline-agent.tavilyApiKey',
      defaultMaxResults: 5,
      defaultSearchDepth: 'basic',
      defaultTopic: 'general',
      includeAnswer: true,
      timeoutMs: 20_000,
      maxBytes: 256 * 1024,
    }),
    fileOps: fileOpsSchema.default({ enabled: true }),
  })
  .describe('Per-tool config (enabled flag, caps, allow/blocklist).');

const routingSchema = z
  .object({
    mode: z
      .enum(['auto', 'simple', 'deep'])
      .default('auto')
      .describe(
        "'auto' runs classifier; 'simple' / 'deep' skip classifier — 'deep' forces multistep with full planner generation.",
      ),
  })
  .describe('Task routing config');

const plannerSchema = z
  .object({
    planMaxSteps: z
      .number()
      .int()
      .min(1)
      .max(16)
      .default(8)
      .describe('Maximum plan length (clamped). Default 8.'),
  })
  .describe('Planner config');

const budgetsSchema = z
  .object({
    maxIterationsSimple: z
      .number()
      .int()
      .min(1)
      .max(64)
      .default(12)
      .describe('Iteration cap when route resolves to simple. Hard max 64.'),
    maxIterationsMultistep: z
      .number()
      .int()
      .min(1)
      .max(64)
      .default(32)
      .describe('Iteration cap when route resolves to multistep. Hard max 64.'),
    maxTokens: z
      .number()
      .int()
      .min(1_000)
      .max(1_000_000)
      .default(100_000)
      .describe('Cumulative input+output token cap.'),
    wallClockMs: z
      .number()
      .int()
      .min(1_000)
      .max(60 * 60 * 1000)
      .default(300_000)
      .describe('Wall-clock cap. Default 5 min.'),
  })
  .describe('Run budgets');

const sandboxSchema = z
  .object({
    quotaBytes: z
      .number()
      .int()
      .min(1 * 1024 * 1024)
      .max(500 * 1024 * 1024)
      .default(50 * 1024 * 1024)
      .describe('Sandbox total bytes cap. Default 50 MB, max 500 MB.'),
    maxArtifacts: z
      .number()
      .int()
      .min(1)
      .max(256)
      .default(32)
      .describe('Maximum artifacts publishable per run.'),
  })
  .describe('Sandbox config');

export const inlineAgentConfigSchema = z
  .object({
    providerId: z
      .string()
      .min(1)
      .default('lmstudio')
      .describe(
        'Provider id from leo provider registry (lmstudio/openai/anthropic/ollama/custom).',
      ),
    model: z.string().default('').describe('Model id passed to the configured provider.'),
    temperature: z.number().min(0).max(2).default(0.2).describe('Sampling temperature in [0, 2].'),
    routing: routingSchema.default({ mode: 'auto' }),
    planner: plannerSchema.default({ planMaxSteps: 8 }),
    budgets: budgetsSchema.default({
      maxIterationsSimple: 12,
      maxIterationsMultistep: 32,
      maxTokens: 100_000,
      wallClockMs: 300_000,
    }),
    sandbox: sandboxSchema.default({
      quotaBytes: 50 * 1024 * 1024,
      maxArtifacts: 32,
    }),
    tools: toolsSchema.default({
      fetchUrl: {
        enabled: true,
        allowlist: [],
        blocklist: [...DEFAULT_FETCH_URL_BLOCKLIST],
        timeoutMs: 30_000,
        maxBytes: 5 * 1024 * 1024,
        requireDnsResolveCheck: true,
        headerDenylist: [...DEFAULT_FETCH_URL_HEADER_DENYLIST],
      },
      searchWeb: {
        enabled: true,
        apiKeyRef: 'safeStorage:externalAgents.inline-agent.tavilyApiKey',
        defaultMaxResults: 5,
        defaultSearchDepth: 'basic',
        defaultTopic: 'general',
        includeAnswer: true,
        timeoutMs: 20_000,
        maxBytes: 256 * 1024,
      },
      fileOps: { enabled: true },
    }),
  })
  .describe(
    'Inline Agent — runs an LLM-driven LangGraph subgraph with a per-run sandbox under <os.tmpdir>/leo-inline-agent/<runId>/. Sandbox is logical (path-prefix only) — it does not protect against bugs in the renderer process or against the configured LLM exfiltrating data via tool arguments.',
  );

export type InlineAgentConfig = z.infer<typeof inlineAgentConfigSchema>;
