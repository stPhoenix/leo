/**
 * Live LLM harness: drive the external-agent subgraph (refine → inline-agent)
 * with the user's "download canon folder" prompt against a real LM Studio
 * endpoint. One vitest invocation = one loop iteration. Writes vault output to
 * `autoresearch/vault/leo-loop-<loopId>/`, JSON logs to
 * `autoresearch/logs/<loopId>.log`, and appends a graded row to
 * `autoresearch/state.md`. Always passes (assertion-free) so the loop driver
 * (claude) can run iter after iter without vitest aborting.
 */
import { promises as fs } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { SlotManager } from '@/agent/externalAgent/slotManager';
import {
  createPassthroughAdapterCallDeps,
  createResultWriterDeps,
} from '@/agent/externalAgent/runPhase';
import { ResultWriter } from '@/agent/externalAgent/resultWriter';
import { createRefineSubAgent } from '@/agent/externalAgent/refineSubAgent';
import { getRefineSystemPrompt } from '@/prompts/agent/externalAgent/refinePrompt';
import {
  InlineAgentAdapter,
  type InlineAgentLogger,
  type ProviderFactory,
  type InlineAgentConfig,
  type InvokeTraceConfig,
} from '@/agent/externalAgent/adapters/inlineAgent';
import type {
  ManualChatModelAdapter as InlineAgentManualChatModelAdapter,
  AssistantStep as InlineAgentAssistantStep,
} from '@/agent/externalAgent/adapters/inlineAgent/manualChatModel';
import type { RewriteMessage as InlineAgentRewriteMessage } from '@/agent/externalAgent/adapters/inlineAgent/multistep/messageRewriter';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';
import { LMStudioProvider } from '@/providers/lmStudioProvider';

import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';

import {
  fetchUrlInputSchema,
  searchWebInputSchema,
  readFileInputSchema,
  writeFileInputSchema,
  listDirInputSchema,
  deleteFileInputSchema,
  appendFileInputSchema,
  grepInputSchema,
  globInputSchema,
  downloadToFileInputSchema,
  publishArtifactInputSchema,
  extractNoteInputSchema,
  todoWriteInputSchema,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/schemas';

const REPO_ROOT = resolve(__dirname, '..', '..');
const AUTORESEARCH_DIR = join(REPO_ROOT, 'autoresearch');
const REFERENCE_CANON_DIR = join(AUTORESEARCH_DIR, 'canon');
const VAULT_PARENT = join(AUTORESEARCH_DIR, 'vault');
const LOGS_DIR = join(AUTORESEARCH_DIR, 'logs');
const STATE_MD_PATH = join(AUTORESEARCH_DIR, 'state.md');

const USER_PROMPT =
  'download canon folder with md files into vault -> https://github.com/stPhoenix/covenantofsilicon/tree/main/canon';

const ENDPOINT = process.env.LEO_LLM_ENDPOINT ?? 'http://localhost:1234';
const CHAT_MODEL = process.env.LEO_LLM_MODEL ?? 'qwen/qwen3.6-27b';
const TEMPERATURE = Number.parseFloat(process.env.LEO_LLM_TEMPERATURE ?? '0.6');
const TIMEOUT_MS = Number.parseInt(process.env.LEO_LOOP_TIMEOUT_MS ?? '900000', 10);

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'qwen/qwen3.6-27b': 80_000,
  'qwen/qwen3.6-35b-a3b': 200_000,
};
const CONTEXT_WINDOW_TOKENS =
  Number.parseInt(process.env.LEO_LLM_CONTEXT_WINDOW ?? '', 10) ||
  MODEL_CONTEXT_WINDOWS[CHAT_MODEL] ||
  32_768;

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
  if (!enabled || host.length === 0 || publicKey.length === 0 || secretKey.length === 0) {
    return { enabled, host, publicKey, secretKey };
  }
  return { enabled, host, publicKey, secretKey };
}

interface LangfuseTurnHandle {
  readonly callbacks: readonly BaseCallbackHandler[];
  readonly metadata: Record<string, unknown>;
  readonly tags: string[];
  flush(): Promise<void>;
}

interface LangfuseHarness {
  beginTurn(input: { sessionId: string; runId: string }): LangfuseTurnHandle;
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
    beginTurn({ sessionId, runId }): LangfuseTurnHandle {
      const trace = client.trace({
        id: sessionId,
        name: `leo.inline-agent.thread:${sessionId}`,
        sessionId,
        tags: ['leo', 'agent:inline-agent', 'harness:canon-download'],
        metadata: { runId, kind: 'leo.inline-agent' },
      });
      const span = trace.span({
        name: 'leo.inline-agent.turn',
        metadata: { runId, agentId: 'inline-agent' },
      });
      const handler = new lcMod.CallbackHandler({
        root: { client, traceId: trace.id, observationId: span.id },
        updateRoot: false,
      }) as BaseCallbackHandler;
      return {
        callbacks: [handler],
        metadata: { runId, agentId: 'inline-agent', langfuseSessionId: sessionId },
        tags: ['leo', 'agent:inline-agent'],
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

const INLINE_TOOL_DEFS = [
  { name: 'fetch_url', description: 'Fetch a web URL.', schema: fetchUrlInputSchema },
  { name: 'search_web', description: 'Search the web.', schema: searchWebInputSchema },
  { name: 'read_file', description: 'Read sandbox file.', schema: readFileInputSchema },
  {
    name: 'write_file',
    description: 'Write sandbox file (overwrite).',
    schema: writeFileInputSchema,
  },
  {
    name: 'append_file',
    description: 'Append content to a sandbox file (creates if missing).',
    schema: appendFileInputSchema,
  },
  { name: 'list_dir', description: 'List sandbox dir.', schema: listDirInputSchema },
  { name: 'delete_file', description: 'Delete sandbox file.', schema: deleteFileInputSchema },
  {
    name: 'grep',
    description: 'Search sandbox files for a substring or regex. Returns {path,line,text} matches.',
    schema: grepInputSchema,
  },
  {
    name: 'glob',
    description: 'List sandbox files matching a glob pattern (e.g. "**/*.md").',
    schema: globInputSchema,
  },
  {
    name: 'download_to_file',
    description:
      'Fetch a URL and write its body to a sandbox path WITHOUT streaming bytes through the model. Prefer this over fetch_url+write_file for saving bytes verbatim.',
    schema: downloadToFileInputSchema,
  },
  {
    name: 'publish_artifact',
    description: 'Publish sandbox file as final artifact.',
    schema: publishArtifactInputSchema,
  },
  { name: 'extract_note', description: 'Save research note.', schema: extractNoteInputSchema },
  {
    name: 'todo_write',
    description: 'Track structured progress on multi-item tasks.',
    schema: todoWriteInputSchema,
  },
] as const;
const INLINE_TOOL_DEF_BY_NAME = new Map<string, (typeof INLINE_TOOL_DEFS)[number]>(
  INLINE_TOOL_DEFS.map((d) => [d.name, d]),
);

function inlineRewriteToLangchain(messages: readonly InlineAgentRewriteMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') out.push(new SystemMessage(m.content));
    else if (m.role === 'human' || m.role === 'user') out.push(new HumanMessage(m.content));
    else if (m.role === 'assistant' || m.role === 'ai') {
      if (m.content.length > 0) out.push(new AIMessage(m.content));
    } else if (m.role === 'tool') {
      const toolName = m.name ?? 'tool';
      out.push(new HumanMessage(`Result from ${toolName}: ${m.content}`));
    }
  }
  return out;
}

function bindInlineChatModelAdapter(
  model: BaseChatModel,
  traceConfig?: InvokeTraceConfig,
): InlineAgentManualChatModelAdapter {
  return {
    async invokeTurn({ messages, toolNames, signal }): Promise<InlineAgentAssistantStep> {
      const lcMessages = inlineRewriteToLangchain(messages);
      const tools = toolNames
        .map((name) => INLINE_TOOL_DEF_BY_NAME.get(name))
        .filter((d): d is (typeof INLINE_TOOL_DEFS)[number] => d !== undefined);
      const callable =
        tools.length > 0
          ? (
              model as unknown as {
                bindTools: (defs: unknown[], opts?: Record<string, unknown>) => BaseChatModel;
              }
            ).bindTools(
              tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema })),
              { parallel_tool_calls: false },
            )
          : model;
      const invokeOpts: Record<string, unknown> = { signal };
      if (traceConfig?.callbacks !== undefined) invokeOpts.callbacks = traceConfig.callbacks;
      if (traceConfig?.metadata !== undefined) invokeOpts.metadata = traceConfig.metadata;
      if (traceConfig?.tags !== undefined) invokeOpts.tags = traceConfig.tags;
      const result = (await callable.invoke(lcMessages, invokeOpts)) as AIMessage;
      const text =
        typeof result.content === 'string'
          ? result.content
          : Array.isArray(result.content)
            ? result.content
                .map((c) => (typeof c === 'string' ? c : 'text' in c ? c.text : ''))
                .join('')
            : '';
      const rawCalls =
        (
          result as unknown as {
            tool_calls?: ReadonlyArray<{ id?: string; name?: string; args?: unknown }>;
          }
        ).tool_calls ?? [];
      const toolCalls = rawCalls
        .filter((tc) => typeof tc.name === 'string' && tc.name.length > 0)
        .map((tc) => ({ id: tc.id ?? '', name: tc.name as string, args: tc.args ?? {} }));
      const usageMeta = (result as unknown as { usage_metadata?: { total_tokens?: number } })
        .usage_metadata;
      const usage = typeof usageMeta?.total_tokens === 'number' ? usageMeta.total_tokens : 0;
      return { text, toolCalls, usage };
    },
  };
}

function makeProviderFactory(): ProviderFactory {
  return (_providerId, model, opts) => {
    const baseURL = `${ENDPOINT.replace(/\/+$/, '')}/v1`;
    return new ChatOpenAI({
      model,
      apiKey: 'lmstudio',
      ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
      maxTokens: 8192,
      streaming: false,
      streamUsage: true,
      configuration: { baseURL, dangerouslyAllowBrowser: true },
    }) as unknown as BaseChatModel;
  };
}

function makeInlineAgentLogger(logger: Logger): InlineAgentLogger {
  return {
    debug: (event, fields = {}) => logger.debug(event, fields),
    info: (event, fields = {}) => logger.info(event, fields),
    warn: (event, fields = {}) => logger.warn(event, fields),
    error: (event, fields = {}) => logger.error(event, fields),
  };
}

async function probeReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT.replace(/\/+$/, '')}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface CanonFileEntry {
  readonly relPath: string;
  readonly bytes: number;
  readonly content: string;
}

async function walkCanon(rootDir: string): Promise<CanonFileEntry[]> {
  const out: CanonFileEntry[] = [];
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
        out.push({ relPath: rel, bytes: Buffer.byteLength(content, 'utf8'), content });
      }
    }
  }
  await walk(rootDir, '');
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

async function findResultCanonDir(vaultRoot: string): Promise<string | null> {
  const externalDir = join(vaultRoot, 'externalAgentResults');
  let entries;
  try {
    entries = await fs.readdir(externalDir, { withFileTypes: true });
  } catch {
    // Maybe the agent wrote canon directly at vault root instead of under externalAgentResults.
    const directCanon = join(vaultRoot, 'canon');
    try {
      const s = await fs.stat(directCanon);
      if (s.isDirectory()) return directCanon;
    } catch {
      /* ignore */
    }
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(externalDir, e.name, 'canon');
    try {
      const s = await fs.stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

interface Grade {
  readonly score: number;
  readonly note: string;
}

function gradeResult(input: {
  readonly errored: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly resultCanonDir: string | null;
  readonly expected: readonly CanonFileEntry[];
  readonly actual: readonly CanonFileEntry[];
}): Grade {
  if (input.errored && input.actual.length === 0) {
    return {
      score: 1,
      note: `error before files: ${input.errorCode ?? 'unknown'} ${input.errorMessage ?? ''}`.trim(),
    };
  }
  if (input.resultCanonDir === null) {
    return { score: 2, note: 'no canon/ folder produced in vault' };
  }
  const expectedPaths = new Set(input.expected.map((f) => f.relPath));
  const actualPaths = new Set(input.actual.map((f) => f.relPath));
  const missing = [...expectedPaths].filter((p) => !actualPaths.has(p));
  const extra = [...actualPaths].filter((p) => !expectedPaths.has(p));

  const matched = input.actual.filter((a) => expectedPaths.has(a.relPath));
  const expectedByPath = new Map(input.expected.map((e) => [e.relPath, e]));
  const byteEqual = matched.filter((a) => {
    const e = expectedByPath.get(a.relPath);
    return e !== undefined && e.content === a.content;
  });
  const total = expectedPaths.size;
  const matchRatio = matched.length / total;
  const exactRatio = byteEqual.length / total;

  if (matched.length === total && byteEqual.length === total) {
    return {
      score: 10,
      note: `perfect — all ${total} files match byte-equal`,
    };
  }
  if (matched.length === total) {
    return {
      score: 8,
      note: `all ${total} paths present; ${byteEqual.length}/${total} byte-equal; content drift on others`,
    };
  }
  let score: number;
  if (matchRatio >= 0.7) score = 6;
  else if (matchRatio >= 0.4) score = 5;
  else if (matchRatio > 0) score = 4;
  else score = 3;
  const noteParts: string[] = [
    `${matched.length}/${total} expected paths present`,
    `${byteEqual.length}/${total} byte-equal`,
  ];
  if (missing.length > 0)
    noteParts.push(`missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
  if (extra.length > 0)
    noteParts.push(`extra: ${extra.slice(0, 3).join(', ')}${extra.length > 3 ? '…' : ''}`);
  if (input.errored) {
    noteParts.push(`errored: ${input.errorCode ?? 'unknown'}`);
    score = Math.min(score, 4);
  }
  void exactRatio;
  return { score, note: noteParts.join('; ') };
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
  '# Inline-agent loop state\n\n' +
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
  const relLog = relative(AUTORESEARCH_DIR, input.logFile);
  const relVault = relative(AUTORESEARCH_DIR, input.vaultRoot);
  return `| ${input.runNumber} | ${input.loopId} | ${input.grade} | ${safeNote} | ${relLog} | ${relVault} |`;
}

async function writePendingRow(input: {
  readonly runNumber: number;
  readonly loopId: string;
  readonly logFile: string;
  readonly vaultRoot: string;
}): Promise<void> {
  const { header, rows } = await loadStateRows();
  rows.push(
    formatRow({
      runNumber: input.runNumber,
      loopId: input.loopId,
      grade: '…',
      note: 'running',
      logFile: input.logFile,
      vaultRoot: input.vaultRoot,
    }),
  );
  await persistStateRows(header, rows);
}

async function finalizeRow(input: {
  readonly runNumber: number;
  readonly loopId: string;
  readonly grade: Grade;
  readonly logFile: string;
  readonly vaultRoot: string;
}): Promise<void> {
  const { header, rows } = await loadStateRows();
  const replacement = formatRow({
    runNumber: input.runNumber,
    loopId: input.loopId,
    grade: input.grade.score,
    note: input.grade.note,
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

describe('inline-agent canon download — live loop iteration', () => {
  it(
    'runs one iteration and records grade',
    async (ctx) => {
      const reachable = await probeReachable();
      if (!reachable) {
        // eslint-disable-next-line no-console
        console.warn(`[loop] LM Studio unreachable at ${ENDPOINT} — skipping iteration`);
        ctx.skip();
        return;
      }

      const loopId = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
      const vaultRoot = join(VAULT_PARENT, `leo-loop-${loopId}`);
      const logFile = join(LOGS_DIR, `${loopId}.log`);

      await fs.mkdir(vaultRoot, { recursive: true });
      await fs.mkdir(LOGS_DIR, { recursive: true });

      const runNumber = await nextRunNumber();
      await writePendingRow({ runNumber, loopId, logFile, vaultRoot });

      const sink = new FsLogSink({ file: logFile });
      const logger = new Logger({ level: 'debug', sink });
      const inlineLogger = makeInlineAgentLogger(logger);

      logger.info('loop.start', {
        loopId,
        prompt: USER_PROMPT,
        endpoint: ENDPOINT,
        chatModel: CHAT_MODEL,
      });

      const vault = new FsVaultAdapter(vaultRoot);
      const writer = new ResultWriter({ vault, logger });

      const adapterRegistry = new AdapterRegistry({
        enabledSource: () => ({ 'inline-agent': true }),
        defaultIdSource: () => 'inline-agent',
      });
      const inlineConfig: InlineAgentConfig = {
        providerId: 'lmstudio',
        model: CHAT_MODEL,
        temperature: TEMPERATURE,
        tools: {
          fetchUrl: {
            enabled: true,
            // Disabled because vitest's pure-Node env has no Electron renderer
            // `globalThis.require('dns')`, so resolveAndCheck fails closed and
            // every fetch is blocked with reason='unsupported'. Production
            // (Obsidian/Electron) keeps this on.
            requireDnsResolveCheck: false,
          },
          searchWeb: { enabled: false, apiKeyRef: '' },
        },
        budgets: {
          wallClockMs: TIMEOUT_MS,
          maxTokens: 500_000,
          maxIterationsSimple: 64,
          maxIterationsMultistep: 64,
          contextWindowTokens: CONTEXT_WINDOW_TOKENS,
          autocompactThresholdPct: 0.75,
        },
      } as unknown as InlineAgentConfig;

      const lfCfg = await loadLangfuseConfigFromDataJson();
      const langfuseHarness = lfCfg !== null ? await makeLangfuseHarness(lfCfg, logger) : null;
      const lfTurnHandles: LangfuseTurnHandle[] = [];
      const inlineAdapter = new InlineAgentAdapter({
        providerFactory: makeProviderFactory(),
        logger: inlineLogger,
        chatModelAdapter: bindInlineChatModelAdapter,
        beginTurn:
          langfuseHarness !== null
            ? ({ sessionId, runId }) => {
                const h = langfuseHarness.beginTurn({ sessionId, runId });
                lfTurnHandles.push(h);
                return {
                  traceConfig: {
                    callbacks: h.callbacks,
                    metadata: h.metadata,
                    tags: h.tags,
                  },
                  end: () => h.flush(),
                };
              }
            : undefined,
      });
      adapterRegistry.register(inlineAdapter);

      const slots = new SlotManager();
      const refineProvider = new LMStudioProvider({ endpoint: () => ENDPOINT });

      const orchestrator = new ExternalAgentOrchestrator({
        registry: adapterRegistry,
        slots,
        refine: createRefineSubAgent({
          provider: refineProvider,
          model: () => CHAT_MODEL,
          temperature: () => TEMPERATURE,
          logger,
        }),
        adapterCall: createPassthroughAdapterCallDeps(),
        writer: createResultWriterDeps(writer),
        systemPrompt: getRefineSystemPrompt(),
        logger,
        resolveConfig: async () => inlineConfig,
      });

      const startResult = orchestrator.start({
        threadId: `loop-${loopId}`,
        originalAsk: USER_PROMPT,
        timeoutMs: TIMEOUT_MS,
      });

      let errored = false;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;

      if (!startResult.ok) {
        errored = true;
        errorCode = 'busy';
        errorMessage = `slot busy on activeRunId=${startResult.activeRunId}`;
        logger.error('loop.start.busy', { activeRunId: startResult.activeRunId });
      } else {
        const handle = startResult.handle;
        // Auto-approve at ready. Poll instead of subscribe to avoid the race
        // where transitionTo('ready') fires listeners synchronously *before*
        // awaitReadyAction installs its resolver (existing subgraph pattern).
        let sentReady = false;
        let pollCancelled = false;
        let clarifyAnswers = 0;
        const MAX_CLARIFY_ANSWERS = 3;
        const AUTO_CLARIFY_ANSWER =
          'No clarification needed. Proceed with the original ask verbatim. Concretely: enumerate all .md files (including the casebooks/ subfolder) under https://github.com/stPhoenix/covenantofsilicon/tree/main/canon via the GitHub Contents API, fetch each via raw.githubusercontent.com, write them under the sandbox path "canon/<original-relative-path>" (preserve casebooks/ subfolder), and call publish_artifact for every .md file. Do not skip files.';
        const pollLoop = (async (): Promise<void> => {
          let lastClarifyMessageCount = -1;
          while (!pollCancelled) {
            const s = handle.state();
            if (s.phase === 'ready' && !sentReady) {
              await new Promise<void>((r) => setImmediate(r));
              try {
                handle.applyReadyAction({ type: 'send' });
                sentReady = true;
                logger.info('loop.ready.sent', {});
              } catch (err) {
                logger.warn('loop.ready-send.failed', {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
              return;
            }
            if (s.phase === 'awaiting_clarify') {
              const last = s.refineHistory[s.refineHistory.length - 1];
              const messageCount = s.refineHistory.length;
              if (messageCount !== lastClarifyMessageCount) {
                lastClarifyMessageCount = messageCount;
                if (clarifyAnswers >= MAX_CLARIFY_ANSWERS) {
                  logger.warn('loop.clarify.budget-exhausted', {
                    answered: clarifyAnswers,
                    question: last?.content?.slice(0, 200),
                  });
                  handle.cancel();
                  return;
                }
                clarifyAnswers += 1;
                await new Promise<void>((r) => setImmediate(r));
                logger.info('loop.clarify.answering', {
                  attempt: clarifyAnswers,
                  question: last?.content?.slice(0, 200),
                });
                try {
                  handle.resumeClarify({ answer: AUTO_CLARIFY_ANSWER });
                } catch (err) {
                  logger.warn('loop.clarify.resume.failed', {
                    error: err instanceof Error ? err.message : String(err),
                  });
                  handle.cancel();
                  return;
                }
              }
            }
            if (
              s.phase === 'done' ||
              s.phase === 'error' ||
              s.phase === 'cancelled' ||
              s.phase === 'running' ||
              s.phase === 'writing'
            ) {
              return;
            }
            await new Promise<void>((r) => setTimeout(r, 200));
          }
        })().catch((err) => {
          logger.error('loop.poll.threw', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        try {
          const final = await startResult.terminal;
          if (!final.ok) {
            errored = true;
            if ('error' in final) {
              errorCode = final.error.code;
              errorMessage = final.error.message;
            } else if ('cancelled' in final) {
              errorCode = 'cancelled';
              errorMessage = `cancelled at phase ${final.phase}`;
            }
          }
          logger.info('loop.terminal', {
            ok: final.ok,
            ...(final.ok
              ? { folder: final.folder, files: final.files, durationMs: final.durationMs }
              : 'error' in final
                ? { errorCode: final.error.code, errorMessage: final.error.message }
                : { cancelled: true, phase: final.phase }),
          });
        } catch (err) {
          errored = true;
          errorCode = 'harness_throw';
          errorMessage = err instanceof Error ? err.message : String(err);
          logger.error('loop.terminal.throw', { error: errorMessage });
        } finally {
          pollCancelled = true;
          await pollLoop;
        }
      }

      const expected = await walkCanon(REFERENCE_CANON_DIR);
      const resultCanonDir = await findResultCanonDir(vaultRoot);
      const actual = resultCanonDir !== null ? await walkCanon(resultCanonDir) : [];

      const grade = gradeResult({
        errored,
        errorCode,
        errorMessage,
        resultCanonDir,
        expected,
        actual,
      });

      logger.info('loop.grade', {
        score: grade.score,
        note: grade.note,
        expected: expected.length,
        actual: actual.length,
        canonDir: resultCanonDir,
      });

      if (langfuseHarness !== null) {
        await langfuseHarness.shutdown();
      }

      await sink.close();

      await finalizeRow({ runNumber, loopId, grade, logFile, vaultRoot });

      // eslint-disable-next-line no-console
      console.log(
        `[loop] iter #${runNumber} loopId=${loopId} grade=${grade.score} — ${grade.note}`,
      );

      expect(grade.score).toBeGreaterThanOrEqual(1);
      expect(grade.note.length).toBeGreaterThan(0);
    },
    TIMEOUT_MS + 60_000,
  );
});
