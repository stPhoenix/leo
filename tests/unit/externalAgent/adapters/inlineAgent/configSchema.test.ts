import { describe, expect, it } from 'vitest';
import {
  inlineAgentConfigSchema,
  DEFAULT_FETCH_URL_BLOCKLIST,
  DEFAULT_FETCH_URL_HEADER_DENYLIST,
  type InlineAgentConfig,
} from '@/agent/externalAgent/adapters/inlineAgent/configSchema';
import { describeConfigSchema } from '@/settings/externalAgentResolver';

describe('inlineAgentConfigSchema (F02)', () => {
  it('accepts the SRS §6 default object (AC1)', () => {
    const fixture = {
      providerId: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.2,
      routing: { mode: 'auto' },
      planner: { planMaxSteps: 8 },
      budgets: {
        maxIterationsSimple: 12,
        maxIterationsMultistep: 32,
        maxTokens: 100_000,
        wallClockMs: 300_000,
      },
      sandbox: { quotaBytes: 52428800, maxArtifacts: 32 },
      tools: {
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
          maxBytes: 262144,
        },
        fileOps: { enabled: true },
      },
    };
    const out: InlineAgentConfig = inlineAgentConfigSchema.parse(fixture);
    expect(out.providerId).toBe('openai');
    expect(out.tools.fetchUrl.blocklist).toEqual(DEFAULT_FETCH_URL_BLOCKLIST);
  });

  it('fills defaults when fields omitted', () => {
    const out = inlineAgentConfigSchema.parse({});
    expect(out.providerId).toBe('lmstudio');
    expect(out.temperature).toBe(0.2);
    expect(out.routing.mode).toBe('auto');
    expect(out.planner.planMaxSteps).toBe(4);
    expect(out.budgets.maxIterationsSimple).toBe(12);
    expect(out.budgets.maxIterationsMultistep).toBe(32);
    expect(out.budgets.maxTokens).toBe(100_000);
    expect(out.budgets.wallClockMs).toBe(300_000);
    expect(out.sandbox.quotaBytes).toBe(50 * 1024 * 1024);
    expect(out.sandbox.maxArtifacts).toBe(32);
    expect(out.tools.fetchUrl.enabled).toBe(true);
    expect(out.tools.fetchUrl.blocklist).toEqual(DEFAULT_FETCH_URL_BLOCKLIST);
    expect(out.tools.fetchUrl.requireDnsResolveCheck).toBe(true);
    expect(out.tools.fetchUrl.headerDenylist).toEqual(DEFAULT_FETCH_URL_HEADER_DENYLIST);
    expect(out.tools.searchWeb.apiKeyRef).toBe(
      'safeStorage:externalAgents.inline-agent.tavilyApiKey',
    );
    expect(out.tools.fileOps.enabled).toBe(true);
  });

  it('default blocklist covers RFC1918 + IPv6 private ranges', () => {
    expect(DEFAULT_FETCH_URL_BLOCKLIST).toEqual(
      expect.arrayContaining([
        '127.0.0.0/8',
        '10.0.0.0/8',
        '172.16.0.0/12',
        '192.168.0.0/16',
        '100.64.0.0/10',
        '169.254.0.0/16',
        '::1',
        'fc00::/7',
        'fe80::/10',
        '::ffff:0:0/96',
      ]),
    );
  });

  it('default headerDenylist strips credential-bearing headers', () => {
    expect(DEFAULT_FETCH_URL_HEADER_DENYLIST).toEqual(
      expect.arrayContaining(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']),
    );
  });

  it('rejects temperature outside [0,2] (AC3)', () => {
    expect(() => inlineAgentConfigSchema.parse({ temperature: -0.1 })).toThrow();
    expect(() => inlineAgentConfigSchema.parse({ temperature: 2.1 })).toThrow();
  });

  it('rejects planner.planMaxSteps > 16', () => {
    expect(() => inlineAgentConfigSchema.parse({ planner: { planMaxSteps: 17 } })).toThrow();
  });

  it('rejects budgets.maxIterations > 64', () => {
    expect(() =>
      inlineAgentConfigSchema.parse({
        budgets: {
          maxIterationsSimple: 65,
          maxIterationsMultistep: 32,
          maxTokens: 100_000,
          wallClockMs: 300_000,
        },
      }),
    ).toThrow();
  });

  it('rejects sandbox.quotaBytes > 500 MB', () => {
    expect(() =>
      inlineAgentConfigSchema.parse({
        sandbox: { quotaBytes: 600 * 1024 * 1024, maxArtifacts: 32 },
      }),
    ).toThrow();
  });
});

describe('describeConfigSchema(inlineAgentConfigSchema) (AC6, AC7)', () => {
  it('emits the NFR-IA-01 sandbox caveat in the top-level description', () => {
    expect(inlineAgentConfigSchema.description).toBeDefined();
    expect(inlineAgentConfigSchema.description ?? '').toMatch(/sandbox is logical/i);
  });

  it('introspects searchWeb.apiKeyRef as a secret field (AC7)', () => {
    const fields = describeConfigSchema(inlineAgentConfigSchema);
    const tools = fields.find((f) => f.path[0] === 'tools');
    expect(tools).toBeDefined();
    const toolsChildren = tools?.children ?? [];
    const searchWeb = toolsChildren.find((f) => f.path.join('.') === 'tools.searchWeb');
    expect(searchWeb).toBeDefined();
    const apiKey = searchWeb?.children?.find((f) => f.path.at(-1) === 'apiKeyRef');
    expect(apiKey).toBeDefined();
    expect(apiKey?.kind).toBe('secret');
  });

  it('exposes routing.mode as a string field with options described', () => {
    const fields = describeConfigSchema(inlineAgentConfigSchema);
    const routing = fields.find((f) => f.path[0] === 'routing');
    expect(routing?.kind).toBe('object');
    const mode = routing?.children?.find((f) => f.path.at(-1) === 'mode');
    expect(mode).toBeDefined();
    expect(mode?.kind).toBe('string');
  });
});
