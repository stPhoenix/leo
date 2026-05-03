/**
 * Live LLM harness: drive the wiki-ingest subgraph (refine pass-through →
 * fetch/persist → planner → extractor → reducer → write) over the 14
 * Canon-of-Silicon raw markdown files mirrored at `autoresearch/canon/`.
 * One vitest invocation = one loop iteration. Writes vault output to
 * `autoresearch/wiki-ingest/vault/leo-loop-<loopId>/`, JSON logs to
 * `autoresearch/wiki-ingest/logs/<loopId>.log`, and appends a pending row
 * (`grade='?'`) to `autoresearch/wiki-ingest/state.md`. Always passes
 * (assertion-free) so the loop driver (claude) can run iter after iter
 * and finalize the row by judging the produced wiki against
 * `.agent/srs/wiki.md`.
 */
import { promises as fs } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { describe, it } from 'vitest';

import {
  startIngestRun,
  type IngestRunDeps,
  type IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { IngestSource } from '@/agent/wiki/ingest/types';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import { createLlmJsonInvoker } from '@/agent/wiki/ingest/llmAdapter';
import { WikiMutex } from '@/agent/wiki/mutex';
import { resolveContextWindow } from '@/agent/compactConstants';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';

import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';

const REPO_ROOT = resolve(__dirname, '..', '..');
const AUTORESEARCH_DIR = join(REPO_ROOT, 'autoresearch');
const REFERENCE_CANON_DIR = join(AUTORESEARCH_DIR, 'canon');
const WIKI_INGEST_DIR = join(AUTORESEARCH_DIR, 'wiki-ingest');
const SCHEMA_SOURCE_PATH = join(WIKI_INGEST_DIR, 'schema.md');
const VAULT_PARENT = join(WIKI_INGEST_DIR, 'vault');
const LOGS_DIR = join(WIKI_INGEST_DIR, 'logs');
const STATE_MD_PATH = join(WIKI_INGEST_DIR, 'state.md');

interface PluginProviderSettings {
  readonly endpoint: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly contextWindowOverride: number | undefined;
  readonly disableThinking: boolean;
}

const DEFAULT_PROVIDER: PluginProviderSettings = {
  endpoint: 'http://localhost:1234',
  model: 'qwen/qwen3.6-27b',
  temperature: 0.7,
  maxTokens: 8192,
  contextWindowOverride: undefined,
  disableThinking: false,
};

async function loadPluginProviderSettings(): Promise<PluginProviderSettings> {
  let raw: string;
  try {
    raw = await fs.readFile(join(REPO_ROOT, 'data.json'), 'utf-8');
  } catch {
    return DEFAULT_PROVIDER;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PROVIDER;
  }
  const root = parsed as { provider?: Record<string, unknown>; contextWindowOverride?: unknown };
  const provider = root.provider;
  if (provider === undefined || provider === null) return DEFAULT_PROVIDER;
  const endpoint =
    typeof provider.endpoint === 'string' && provider.endpoint.length > 0
      ? provider.endpoint
      : DEFAULT_PROVIDER.endpoint;
  const model =
    typeof provider.chatModel === 'string' && provider.chatModel.length > 0
      ? provider.chatModel
      : DEFAULT_PROVIDER.model;
  const temperature =
    typeof provider.temperature === 'number' ? provider.temperature : DEFAULT_PROVIDER.temperature;
  const maxTokens =
    typeof provider.maxTokens === 'number' && provider.maxTokens > 0
      ? provider.maxTokens
      : DEFAULT_PROVIDER.maxTokens;
  const contextWindowOverride =
    typeof root.contextWindowOverride === 'number' && root.contextWindowOverride > 0
      ? root.contextWindowOverride
      : undefined;
  const disableThinking =
    typeof provider.disableThinking === 'boolean'
      ? provider.disableThinking
      : DEFAULT_PROVIDER.disableThinking;
  return {
    endpoint,
    model,
    temperature,
    maxTokens,
    contextWindowOverride,
    disableThinking,
  };
}

const TIMEOUT_MS = Number.parseInt(process.env.LEO_LOOP_TIMEOUT_MS ?? '1500000', 10);

interface LangfuseHarnessConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly publicKey: string;
  readonly secretKey: string;
}

async function loadLangfuseConfigFromDataJson(): Promise<LangfuseHarnessConfig | null> {
  const dataJsonPath = join(REPO_ROOT, 'data.json');
  let raw: string;
  try {
    raw = await fs.readFile(dataJsonPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const lf = (parsed as { langfuse?: Record<string, unknown> }).langfuse;
  if (lf === undefined || lf === null) return null;
  const enabled = lf.enabled === true;
  const host = typeof lf.host === 'string' ? lf.host.trim() : '';
  const publicKey =
    process.env.LANGFUSE_PUBLIC_KEY ?? (typeof lf.publicKey === 'string' ? lf.publicKey : '');
  const secretKey =
    process.env.LANGFUSE_SECRET_KEY ?? (typeof lf.secretKey === 'string' ? lf.secretKey : '');
  return { enabled, host, publicKey, secretKey };
}

interface LangfuseRunHandle {
  readonly callbacks: readonly BaseCallbackHandler[];
  readonly metadata: Record<string, unknown>;
  readonly tags: string[];
  flush(): Promise<void>;
}

interface LangfuseHarness {
  beginRun(input: { sessionId: string; runId: string }): LangfuseRunHandle;
  shutdown(): Promise<void>;
}

async function makeLangfuseHarness(
  cfg: LangfuseHarnessConfig,
  logger: Logger,
): Promise<LangfuseHarness | null> {
  if (!cfg.enabled || cfg.publicKey.length === 0 || cfg.secretKey.length === 0) {
    logger.warn('langfuse.harness.skip', {
      enabled: cfg.enabled,
      hasPublic: cfg.publicKey.length > 0,
      hasSecret: cfg.secretKey.length > 0,
    });
    return null;
  }
  let langfuseMod: { Langfuse: new (opts: Record<string, unknown>) => unknown };
  let lcMod: { CallbackHandler: new (opts: Record<string, unknown>) => unknown };
  try {
    langfuseMod = (await import('langfuse')) as unknown as typeof langfuseMod;
    lcMod = (await import('langfuse-langchain')) as unknown as typeof lcMod;
  } catch (err) {
    logger.warn('langfuse.harness.import-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  const client = new langfuseMod.Langfuse({
    publicKey: cfg.publicKey,
    secretKey: cfg.secretKey,
    baseUrl: cfg.host,
    flushAt: 1,
  }) as {
    trace(opts: Record<string, unknown>): {
      readonly id: string;
      span(opts: Record<string, unknown>): { readonly id: string; end(): void };
    };
    flushAsync(): Promise<unknown>;
    shutdownAsync(): Promise<unknown>;
  };
  logger.info('langfuse.harness.ready', { host: cfg.host });
  return {
    beginRun({ sessionId, runId }): LangfuseRunHandle {
      const trace = client.trace({
        id: sessionId,
        name: `leo.wiki-ingest.thread:${sessionId}`,
        sessionId,
        tags: ['leo', 'agent:wiki-ingest', 'harness:canon-ingest'],
        metadata: { runId, kind: 'leo.wiki-ingest' },
      });
      const span = trace.span({
        name: 'leo.wiki-ingest.run',
        metadata: { runId, agentId: 'wiki-ingest' },
      });
      const handler = new lcMod.CallbackHandler({
        root: { client, traceId: trace.id, observationId: span.id },
        updateRoot: false,
      }) as BaseCallbackHandler;
      return {
        callbacks: [handler],
        metadata: { runId, agentId: 'wiki-ingest', langfuseSessionId: sessionId },
        tags: ['leo', 'agent:wiki-ingest'],
        async flush(): Promise<void> {
          try {
            span.end();
          } catch {
            /* ignore */
          }
          const flushable = handler as { flushAsync?: () => Promise<unknown> };
          if (typeof flushable.flushAsync === 'function') {
            try {
              await flushable.flushAsync();
            } catch (err) {
              logger.warn('langfuse.harness.flush-failed', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        },
      };
    },
    async shutdown(): Promise<void> {
      try {
        await client.flushAsync();
        await client.shutdownAsync();
      } catch (err) {
        logger.warn('langfuse.harness.shutdown-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

interface FsLogSinkOptions {
  readonly file: string;
}

class FsLogSink implements LogSink {
  private buffer: string[] = [];
  private fh: fs.FileHandle | null = null;
  private opening: Promise<void> | null = null;

  constructor(private readonly opts: FsLogSinkOptions) {}

  async write(record: LogRecord): Promise<void> {
    const line =
      JSON.stringify({
        ts: record.ts,
        level: record.level,
        event: record.event,
        ...record.fields,
      }) + '\n';
    this.buffer.push(line);
    await this.flushIfReady();
  }

  async flush(): Promise<void> {
    await this.flushIfReady();
    if (this.fh !== null) {
      await this.fh.sync();
    }
  }

  async close(): Promise<void> {
    await this.flush();
    if (this.fh !== null) {
      await this.fh.close();
      this.fh = null;
    }
  }

  private async ensureOpen(): Promise<void> {
    if (this.fh !== null) return;
    if (this.opening !== null) return this.opening;
    this.opening = (async () => {
      await fs.mkdir(dirname(this.opts.file), { recursive: true });
      this.fh = await fs.open(this.opts.file, 'a');
    })();
    await this.opening;
    this.opening = null;
  }

  private async flushIfReady(): Promise<void> {
    await this.ensureOpen();
    if (this.fh === null) return;
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.join('');
    this.buffer = [];
    await this.fh.write(chunk);
  }
}

class FsVaultAdapter implements VaultAdapter {
  constructor(private readonly root: string) {}

  private abs(p: string): string {
    const safe = p.replace(/^\/+/, '');
    const full = resolve(this.root, safe);
    if (!full.startsWith(this.root)) {
      throw new Error(`path escapes vault root: ${p}`);
    }
    return full;
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.stat(this.abs(p));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(p: string): Promise<void> {
    await fs.mkdir(this.abs(p), { recursive: true });
  }

  async read(p: string): Promise<string> {
    return fs.readFile(this.abs(p), 'utf8');
  }

  async write(p: string, data: string): Promise<void> {
    const target = this.abs(p);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, data, 'utf8');
  }

  async writeBinary(p: string, data: Uint8Array): Promise<void> {
    const target = this.abs(p);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.abs(from), this.abs(to));
  }

  async remove(p: string): Promise<void> {
    await fs.rm(this.abs(p), { force: true });
  }

  async rmdir(p: string): Promise<void> {
    await fs.rm(this.abs(p), { recursive: true, force: true });
  }

  async list(p: string): Promise<VaultListing> {
    const dir = this.abs(p);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return { files: [], folders: [] };
    }
    const files: string[] = [];
    const folders: string[] = [];
    for (const e of entries) {
      const rel = p === '' ? e.name : `${p.replace(/\/+$/, '')}/${e.name}`;
      if (e.isDirectory()) folders.push(rel);
      else if (e.isFile()) files.push(rel);
    }
    return { files, folders };
  }

  async stat(p: string): Promise<VaultStat | null> {
    try {
      const s = await fs.stat(this.abs(p));
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }
}

async function probeReachable(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface CanonFile {
  readonly relPath: string;
  readonly content: string;
}

async function walkCanon(rootDir: string): Promise<CanonFile[]> {
  const out: CanonFile[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.gitkeep') continue;
      const sub = join(dir, e.name);
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) {
        await walk(sub, rel);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        const content = await fs.readFile(sub, 'utf8');
        out.push({ relPath: rel, content });
      }
    }
  }
  await walk(rootDir, '');
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

async function nextRunNumber(): Promise<number> {
  let content: string;
  try {
    content = await fs.readFile(STATE_MD_PATH, 'utf8');
  } catch {
    return 1;
  }
  const lines = content.split(/\r?\n/);
  let max = 0;
  for (const line of lines) {
    const m = /^\|\s*(\d+)\s*\|/.exec(line);
    if (m !== null) {
      const n = Number.parseInt(m[1] ?? '', 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

const STATE_HEADER =
  '# Wiki-ingest loop state\n\n' +
  '| run_number | loop_id | grade | note | log | vault |\n' +
  '|---|---|---|---|---|---|\n';

async function loadStateRows(): Promise<{ header: string; rows: string[] }> {
  let content = '';
  try {
    content = await fs.readFile(STATE_MD_PATH, 'utf8');
  } catch {
    /* fresh */
  }
  if (!content.includes('| run_number ')) {
    return { header: STATE_HEADER, rows: [] };
  }
  const lines = content.split(/\r?\n/);
  const rows: string[] = [];
  for (const line of lines) {
    if (/^\|\s*\d+\s*\|/.test(line)) rows.push(line);
  }
  return { header: STATE_HEADER, rows };
}

async function persistStateRows(header: string, rows: readonly string[]): Promise<void> {
  await fs.mkdir(dirname(STATE_MD_PATH), { recursive: true });
  const body = rows.length === 0 ? '' : rows.join('\n') + '\n';
  await fs.writeFile(STATE_MD_PATH, header + body, 'utf8');
}

function formatRow(input: {
  readonly runNumber: number;
  readonly loopId: string;
  readonly grade: number | string;
  readonly note: string;
  readonly logFile: string;
  readonly vaultRoot: string;
}): string {
  const safeNote = input.note.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const relLog = relative(WIKI_INGEST_DIR, input.logFile);
  const relVault = relative(WIKI_INGEST_DIR, input.vaultRoot);
  return `| ${input.runNumber} | ${input.loopId} | ${input.grade} | ${safeNote} | ${relLog} | ${relVault} |`;
}

async function writePendingRow(input: {
  readonly runNumber: number;
  readonly loopId: string;
  readonly logFile: string;
  readonly vaultRoot: string;
  readonly note: string;
}): Promise<void> {
  const { header, rows } = await loadStateRows();
  rows.push(
    formatRow({
      runNumber: input.runNumber,
      loopId: input.loopId,
      grade: '?',
      note: input.note,
      logFile: input.logFile,
      vaultRoot: input.vaultRoot,
    }),
  );
  await persistStateRows(header, rows);
}

async function updatePendingRow(input: {
  readonly runNumber: number;
  readonly loopId: string;
  readonly logFile: string;
  readonly vaultRoot: string;
  readonly note: string;
}): Promise<void> {
  const { header, rows } = await loadStateRows();
  const replacement = formatRow({
    runNumber: input.runNumber,
    loopId: input.loopId,
    grade: '?',
    note: input.note,
    logFile: input.logFile,
    vaultRoot: input.vaultRoot,
  });
  let replaced = false;
  for (let i = 0; i < rows.length; i += 1) {
    if (new RegExp(`^\\|\\s*${input.runNumber}\\s*\\|`).test(rows[i] ?? '')) {
      rows[i] = replacement;
      replaced = true;
      break;
    }
  }
  if (!replaced) rows.push(replacement);
  await persistStateRows(header, rows);
}

function buildChatModelInvoker(
  provider: PluginProviderSettings,
  langfuse: LangfuseRunHandle | null,
): LlmJsonInvoker {
  const providerKind = (process.env.LEO_LLM_PROVIDER ?? 'lmstudio').toLowerCase();
  let chat: BaseChatModel;
  if (providerKind === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey === '') {
      throw new Error('LEO_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY not set');
    }
    chat = new ChatAnthropic({
      model: provider.model,
      apiKey,
      temperature: provider.temperature,
      maxTokens: 8192,
      streaming: false,
    });
  } else {
    const baseURL = `${provider.endpoint.replace(/\/+$/, '')}/v1`;
    chat = new ChatOpenAI({
      model: provider.model,
      apiKey: 'lmstudio',
      temperature: provider.temperature,
      maxTokens: 8192,
      streaming: false,
      streamUsage: false,
      ...(provider.disableThinking
        ? { modelKwargs: { extra_body: { chat_template_kwargs: { enable_thinking: false } } } }
        : {}),
      configuration: { baseURL, dangerouslyAllowBrowser: true },
    });
  }
  return createLlmJsonInvoker({
    chatModel: () => chat,
    getInvokeOptions:
      langfuse === null
        ? undefined
        : () => ({
            callbacks: langfuse.callbacks,
            metadata: langfuse.metadata,
            tags: langfuse.tags,
          }),
  });
}

async function copyCanonInto(targetRoot: string, files: readonly CanonFile[]): Promise<void> {
  for (const f of files) {
    const target = join(targetRoot, f.relPath);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, f.content, 'utf8');
  }
}

describe('wiki-ingest canon ingest — live loop iteration', () => {
  it(
    'runs one iteration and records pending row for claude-as-judge',
    async (ctx) => {
      const pluginSettings = await loadPluginProviderSettings();
      const provider: PluginProviderSettings = {
        endpoint: process.env.LEO_LLM_ENDPOINT ?? pluginSettings.endpoint,
        model: process.env.LEO_LLM_MODEL ?? pluginSettings.model,
        temperature:
          process.env.LEO_LLM_TEMPERATURE !== undefined
            ? Number.parseFloat(process.env.LEO_LLM_TEMPERATURE)
            : pluginSettings.temperature,
        maxTokens:
          process.env.LEO_LLM_MAX_TOKENS !== undefined
            ? Number.parseInt(process.env.LEO_LLM_MAX_TOKENS, 10)
            : pluginSettings.maxTokens,
        contextWindowOverride:
          process.env.LEO_LLM_CONTEXT_WINDOW !== undefined
            ? Number.parseInt(process.env.LEO_LLM_CONTEXT_WINDOW, 10)
            : pluginSettings.contextWindowOverride,
        disableThinking:
          process.env.LEO_LLM_DISABLE_THINKING !== undefined
            ? /^(1|true|yes)$/i.test(process.env.LEO_LLM_DISABLE_THINKING)
            : pluginSettings.disableThinking,
      };

      const providerKind = (process.env.LEO_LLM_PROVIDER ?? 'lmstudio').toLowerCase();
      if (providerKind !== 'anthropic') {
        const reachable = await probeReachable(provider.endpoint);
        if (!reachable) {
          // eslint-disable-next-line no-console
          console.warn(`[wiki-loop] LM Studio unreachable at ${provider.endpoint} — skipping`);
          ctx.skip();
          return;
        }
      }

      const loopId = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
      const vaultRoot = join(VAULT_PARENT, `leo-loop-${loopId}`);
      const logFile = join(LOGS_DIR, `${loopId}.log`);

      await fs.mkdir(vaultRoot, { recursive: true });
      await fs.mkdir(LOGS_DIR, { recursive: true });

      const runNumber = await nextRunNumber();
      await writePendingRow({
        runNumber,
        loopId,
        logFile,
        vaultRoot,
        note: 'running',
      });

      const sink = new FsLogSink({ file: logFile });
      const logger = new Logger({ level: 'debug', sink });

      logger.info('loop.start', {
        loopId,
        endpoint: provider.endpoint,
        chatModel: provider.model,
        temperature: provider.temperature,
      });

      // Stage canon raw sources at <vaultRoot>/source-input/canon/** (immutable
      // input). Stage seed schema at <vaultRoot>/wiki/SCHEMA.md so subagents
      // see it during planning/extraction/reduction. LEO_WIKI_SOURCE_LIMIT=N
      // truncates to the first N files (alphabetical) for fast iteration; 0 or
      // unset = all files.
      const sourceLimit = Number.parseInt(process.env.LEO_WIKI_SOURCE_LIMIT ?? '0', 10);
      const allCanonFiles = await walkCanon(REFERENCE_CANON_DIR);
      const canonFiles =
        Number.isFinite(sourceLimit) && sourceLimit > 0
          ? allCanonFiles.slice(0, sourceLimit)
          : allCanonFiles;
      const inputRoot = join(vaultRoot, 'source-input', 'canon');
      await copyCanonInto(inputRoot, canonFiles);
      const schemaSource = await fs.readFile(SCHEMA_SOURCE_PATH, 'utf8');
      await fs.mkdir(join(vaultRoot, 'wiki'), { recursive: true });
      await fs.writeFile(join(vaultRoot, 'wiki', 'SCHEMA.md'), schemaSource, 'utf8');

      logger.info('loop.staged', {
        sourceCount: canonFiles.length,
        sourceLimit: sourceLimit > 0 ? sourceLimit : null,
        totalAvailable: allCanonFiles.length,
        inputRoot: relative(vaultRoot, inputRoot),
        schemaPath: 'wiki/SCHEMA.md',
      });

      const sources: IngestSource[] = canonFiles.map((f) => ({
        kind: 'vaultPath',
        path: `source-input/canon/${f.relPath}`,
      }));

      const lfCfg = await loadLangfuseConfigFromDataJson();
      const langfuseHarness = lfCfg !== null ? await makeLangfuseHarness(lfCfg, logger) : null;
      const lfHandle =
        langfuseHarness !== null
          ? langfuseHarness.beginRun({ sessionId: `loop-${loopId}`, runId: loopId })
          : null;

      const llm: LlmJsonInvoker = buildChatModelInvoker(provider, lfHandle);

      const vault = new FsVaultAdapter(vaultRoot);
      const mutex = new WikiMutex({ logger });

      const contextWindow = resolveContextWindow({
        model: provider.model,
        ...(provider.contextWindowOverride !== undefined
          ? { userOverride: provider.contextWindowOverride }
          : {}),
      });
      logger.info('loop.budgets', {
        contextWindow,
        maxOutputTokens: provider.maxTokens,
        contextWindowOverride: provider.contextWindowOverride ?? null,
        disableThinking: provider.disableThinking,
      });

      const deps: IngestRunDeps = {
        vault,
        mutex,
        logger,
        llm,
        fetch: {},
        requestDuplicateChoice: () => Promise.resolve('reprocess'),
        skipCancelDeadline: true,
        contextWindow,
        maxOutputTokens: provider.maxTokens,
      };

      let terminal: IngestTerminalResult | null = null;
      let errored = false;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;
      let internalTimeoutFired = false;

      const startResult = startIngestRun(
        {
          threadId: `loop-${loopId}`,
          originalAsk: 'Ingest the Canon of Silicon books into the wiki',
          sources,
          note: 'autoresearch wiki-ingest loop',
        },
        deps,
      );

      // Internal soft-timeout: abort the run a margin before vitest's hard
      // timeout fires so the harness gets a chance to finalize the state.md
      // row, flush logs, and write a terminal record. Without this, a hung
      // model leaves a pending '?' row stuck on "running" forever.
      const SOFT_TIMEOUT_MARGIN_MS = 45_000;
      const softTimeoutMs = Math.max(60_000, TIMEOUT_MS - SOFT_TIMEOUT_MARGIN_MS);
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      if (startResult.ok) {
        const handle = startResult.handle;
        timeoutHandle = setTimeout(() => {
          internalTimeoutFired = true;
          logger.warn('loop.soft-timeout', { softTimeoutMs });
          try {
            handle.abort();
          } catch {
            /* ignore */
          }
        }, softTimeoutMs);
      }

      if (!startResult.ok) {
        errored = true;
        errorCode = 'busy';
        errorMessage = `mutex busy on activeRunId=${startResult.busy.activeRunId}`;
        logger.error('loop.start.busy', { activeRunId: startResult.busy.activeRunId });
      } else {
        try {
          terminal = await startResult.handle.terminal;
          if (!terminal.ok) {
            errored = true;
            if ('error' in terminal) {
              errorCode = terminal.error.code;
              errorMessage = terminal.error.message;
            } else if ('cancelled' in terminal) {
              errorCode = 'cancelled';
              errorMessage = internalTimeoutFired
                ? `soft-timeout at phase ${terminal.phase} after ${softTimeoutMs}ms`
                : `cancelled at phase ${terminal.phase}`;
            }
          }
        } catch (err) {
          errored = true;
          errorCode = 'harness_throw';
          errorMessage = err instanceof Error ? err.message : String(err);
          logger.error('loop.terminal.throw', { error: errorMessage });
        } finally {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        }
      }

      const terminalPayload =
        terminal === null
          ? { ok: false, errored, errorCode, errorMessage, internalTimeoutFired }
          : terminal.ok
            ? {
                ok: true,
                ingestId: terminal.data.ingestId,
                pagesCreated: terminal.data.pagesCreated,
                pagesEdited: terminal.data.pagesEdited,
                durationMs: terminal.data.durationMs,
                sourceCount: terminal.data.sources.length,
              }
            : 'error' in terminal
              ? {
                  ok: false,
                  errorCode: terminal.error.code,
                  errorMessage: terminal.error.message,
                  partial: terminal.partial,
                }
              : {
                  ok: false,
                  cancelled: true,
                  phase: terminal.phase,
                  partial: terminal.partial,
                  internalTimeoutFired,
                };
      logger.info('loop.terminal', terminalPayload);

      if (lfHandle !== null) await lfHandle.flush();
      if (langfuseHarness !== null) await langfuseHarness.shutdown();

      await sink.close();

      const pendingNote = errored
        ? `harness recorded; needs judgment (errored: ${errorCode ?? 'unknown'} ${errorMessage ?? ''})`.slice(
            0,
            240,
          )
        : 'harness recorded; needs judgment';
      await updatePendingRow({
        runNumber,
        loopId,
        logFile,
        vaultRoot,
        note: pendingNote,
      });

      // eslint-disable-next-line no-console
      console.log(
        `[wiki-loop] iter #${runNumber} loopId=${loopId} terminal=${
          terminal === null ? 'no-start' : terminal.ok ? 'ok' : 'error/cancelled'
        } — judgment pending`,
      );
    },
    TIMEOUT_MS + 60_000,
  );
});
