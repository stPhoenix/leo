import { z } from 'zod';

export const openfangConfigSchema = z
  .object({
    baseUrl: z
      .string()
      .url()
      .describe('Base URL of the OpenFang daemon, e.g. https://openfang.example.com:4200'),
    apiKey: z
      .string()
      .min(1)
      .describe('secret\nAPI key shared by the daemon operator. Sent as Authorization: Bearer.'),
    sessionId: z
      .string()
      .optional()
      .describe(
        'Optional A2A sessionId — pass to correlate multiple tasks in one logical conversation.',
      ),
    pollTimeoutMs: z
      .number()
      .int()
      .min(60_000)
      .default(1_800_000)
      .describe('Hard ceiling on polling duration. Default 30 min.'),
    pollInitialIntervalMs: z
      .number()
      .int()
      .min(2_000)
      .default(2_000)
      .describe('First poll interval. Daemon caches faster requests; minimum 2000.'),
    pollMaxIntervalMs: z
      .number()
      .int()
      .min(2_000)
      .max(60_000)
      .default(15_000)
      .describe('Maximum back-off interval between polls.'),
    httpTimeoutMs: z
      .number()
      .int()
      .min(1_000)
      .default(30_000)
      .describe('Per-request HTTP timeout. Applied to every authenticated call.'),
    allowInsecureHttp: z
      .boolean()
      .default(false)
      .describe('Permit http:// base URLs. Off by default — TLS is strongly recommended.'),
  })
  .strict()
  .refine((c) => c.pollMaxIntervalMs >= c.pollInitialIntervalMs, {
    message: 'pollMaxIntervalMs must be >= pollInitialIntervalMs',
    path: ['pollMaxIntervalMs'],
  });

export type OpenfangConfig = z.infer<typeof openfangConfigSchema>;
