import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  openfangConfigSchema,
  type OpenfangConfig,
} from '@/agent/externalAgent/adapters/openfang/configSchema';

describe('openfangConfigSchema', () => {
  it('parses minimal valid config and applies defaults', () => {
    const parsed = openfangConfigSchema.parse({
      baseUrl: 'https://openfang.example.com:4200',
      apiKey: 'k',
    });
    expect(parsed).toEqual({
      baseUrl: 'https://openfang.example.com:4200',
      apiKey: 'k',
      pollTimeoutMs: 1_800_000,
      pollInitialIntervalMs: 2_000,
      pollMaxIntervalMs: 15_000,
      httpTimeoutMs: 30_000,
      allowInsecureHttp: false,
    });
  });

  it('preserves baseUrl as entered (trailing slash strip happens in httpClient join)', () => {
    const parsed = openfangConfigSchema.parse({
      baseUrl: 'https://openfang.example.com:4200/',
      apiKey: 'k',
    });
    expect(parsed.baseUrl).toBe('https://openfang.example.com:4200/');
  });

  it.each([
    {
      name: 'rejects missing apiKey',
      input: { baseUrl: 'https://x' },
      path: ['apiKey'],
    },
    {
      name: 'rejects empty apiKey',
      input: { baseUrl: 'https://x', apiKey: '' },
      path: ['apiKey'],
    },
    {
      name: 'rejects baseUrl not a URL',
      input: { baseUrl: 'not-a-url', apiKey: 'k' },
      path: ['baseUrl'],
    },
    {
      name: 'rejects pollInitialIntervalMs below 2000',
      input: { baseUrl: 'https://x', apiKey: 'k', pollInitialIntervalMs: 1_000 },
      path: ['pollInitialIntervalMs'],
    },
    {
      name: 'rejects pollMaxIntervalMs below 2000',
      input: { baseUrl: 'https://x', apiKey: 'k', pollMaxIntervalMs: 1_500 },
      path: ['pollMaxIntervalMs'],
    },
  ])('$name', ({ input, path }) => {
    const result = openfangConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain(path.join('.'));
    }
  });

  it('rejects unknown keys (strict)', () => {
    const result = openfangConfigSchema.safeParse({
      baseUrl: 'https://x',
      apiKey: 'k',
      extra: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.code);
      expect(codes).toContain('unrecognized_keys');
    }
  });

  it('rejects pollMaxIntervalMs < pollInitialIntervalMs', () => {
    const result = openfangConfigSchema.safeParse({
      baseUrl: 'https://x',
      apiKey: 'k',
      pollInitialIntervalMs: 10_000,
      pollMaxIntervalMs: 5_000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('pollMaxIntervalMs');
    }
  });

  it('accepts allowInsecureHttp true with http baseUrl (parser-level)', () => {
    const parsed = openfangConfigSchema.parse({
      baseUrl: 'http://localhost:4200',
      apiKey: 'k',
      allowInsecureHttp: true,
    });
    expect(parsed.baseUrl).toBe('http://localhost:4200');
    expect(parsed.allowInsecureHttp).toBe(true);
  });

  it("schema source carries .describe('secret') marker on apiKey", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../../../../src/agent/externalAgent/adapters/openfang/configSchema.ts',
      ),
      'utf8',
    );
    expect(source).toMatch(/apiKey:[^,]*\.describe\(\s*['"`]secret\\n/);
  });

  it('exports OpenfangConfig type inferred from schema', () => {
    const cfg: OpenfangConfig = openfangConfigSchema.parse({
      baseUrl: 'https://x',
      apiKey: 'k',
    });
    expect(cfg.baseUrl).toBe('https://x');
  });
});
