import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export interface SandboxLogger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export type SandboxResolveResult =
  | { readonly ok: true; readonly absPath: string }
  | { readonly ok: false; readonly error: 'path_outside_sandbox' };

export type SandboxCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'path_outside_sandbox' | 'not_found' };

export type SandboxInitResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: 'sandbox_init_failed' | 'sandbox_collision';
      readonly cause?: string;
    };

export interface SandboxOptions {
  readonly runId: string;
  readonly logger: SandboxLogger;
  readonly quotaBytes?: number;
  readonly tempDir?: () => string;
}

const ROOT_DIR_NAME = 'leo-inline-agent';
const ORPHAN_AGE_MS = 60 * 60 * 1000;
const DEFAULT_QUOTA_BYTES = 50 * 1024 * 1024;

export class Sandbox {
  readonly runId: string;
  readonly quotaBytes: number;
  private readonly logger: SandboxLogger;
  private readonly tempDir: () => string;
  private _root: string;
  private _bytes = 0;
  private _initialized = false;
  private _cleaned = false;

  constructor(opts: SandboxOptions) {
    this.runId = opts.runId;
    this.logger = opts.logger;
    this.quotaBytes = opts.quotaBytes ?? DEFAULT_QUOTA_BYTES;
    this.tempDir = opts.tempDir ?? ((): string => tmpdir());
    this._root = join(this.tempDir(), ROOT_DIR_NAME, this.runId);
  }

  get root(): string {
    return this._root;
  }

  bytes(): number {
    return this._bytes;
  }

  addBytes(delta: number): void {
    this._bytes = Math.max(0, this._bytes + delta);
  }

  willExceedQuota(extraBytes: number): boolean {
    return this._bytes + extraBytes > this.quotaBytes;
  }

  async init(): Promise<SandboxInitResult> {
    if (this._initialized) return { ok: true };
    try {
      await fs.mkdir(this._root, { recursive: false, mode: 0o700 });
    } catch (err) {
      const code = errorCode(err);
      if (code === 'EEXIST') {
        return { ok: false, error: 'sandbox_collision', cause: 'directory exists' };
      }
      if (code === 'ENOENT') {
        try {
          await fs.mkdir(join(this.tempDir(), ROOT_DIR_NAME), {
            recursive: true,
            mode: 0o700,
          });
          await fs.mkdir(this._root, { recursive: false, mode: 0o700 });
        } catch (err2) {
          this.logger.warn('externalAgent.adapter.inlineAgent.sandbox.init-failed', {
            runId: this.runId,
            error: err2 instanceof Error ? err2.message : String(err2),
          });
          return {
            ok: false,
            error: 'sandbox_init_failed',
            cause: err2 instanceof Error ? err2.message : String(err2),
          };
        }
        this._initialized = true;
        return { ok: true };
      }
      this.logger.warn('externalAgent.adapter.inlineAgent.sandbox.init-failed', {
        runId: this.runId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error: 'sandbox_init_failed',
        cause: err instanceof Error ? err.message : String(err),
      };
    }
    this._initialized = true;
    return { ok: true };
  }

  resolve(relPath: string): SandboxResolveResult {
    if (typeof relPath !== 'string') {
      return { ok: false, error: 'path_outside_sandbox' };
    }
    if (relPath.length === 0) {
      return { ok: true, absPath: this._root };
    }
    let abs: string;
    try {
      abs = resolve(this._root, relPath);
    } catch {
      return { ok: false, error: 'path_outside_sandbox' };
    }
    if (abs === this._root) {
      return { ok: true, absPath: abs };
    }
    if (!abs.startsWith(this._root + sep)) {
      return { ok: false, error: 'path_outside_sandbox' };
    }
    return { ok: true, absPath: abs };
  }

  async checkSafe(absPath: string): Promise<SandboxCheckResult> {
    if (absPath !== this._root && !absPath.startsWith(this._root + sep)) {
      return { ok: false, error: 'path_outside_sandbox' };
    }
    const segments = pathSegmentsBetween(this._root, absPath);
    let cursor = this._root;
    for (const segment of segments) {
      cursor = join(cursor, segment);
      try {
        const stat = await fs.lstat(cursor);
        if (stat.isSymbolicLink()) {
          return { ok: false, error: 'path_outside_sandbox' };
        }
      } catch (err) {
        const code = errorCode(err);
        if (code === 'ENOENT') {
          return { ok: false, error: 'not_found' };
        }
        return { ok: false, error: 'path_outside_sandbox' };
      }
    }
    return { ok: true };
  }

  async cleanup(): Promise<void> {
    if (this._cleaned) return;
    this._cleaned = true;
    try {
      await fs.rm(this._root, { recursive: true, force: true });
    } catch (err) {
      this.logger.warn('externalAgent.adapter.inlineAgent.sandbox.cleanup-failed', {
        runId: this.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  static async sweepOrphans(input: {
    readonly logger: SandboxLogger;
    readonly now?: () => number;
    readonly tempDir?: () => string;
    readonly maxAgeMs?: number;
  }): Promise<void> {
    const now = (input.now ?? ((): number => Date.now()))();
    const tempDir = (input.tempDir ?? ((): string => tmpdir()))();
    const maxAge = input.maxAgeMs ?? ORPHAN_AGE_MS;
    const root = join(tempDir, ROOT_DIR_NAME);
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ENOENT') return;
      input.logger.warn('externalAgent.adapter.inlineAgent.sandbox.sweep-readdir-failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      try {
        const stat = await fs.stat(dir);
        if (!stat.isDirectory()) continue;
        if (now - stat.mtimeMs <= maxAge) continue;
        await fs.rm(dir, { recursive: true, force: true });
      } catch (err) {
        input.logger.warn('externalAgent.adapter.inlineAgent.sandbox.sweep-rm-failed', {
          dir,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

function pathSegmentsBetween(root: string, abs: string): readonly string[] {
  if (abs === root) return [];
  const tail = abs.startsWith(root + sep) ? abs.slice(root.length + sep.length) : abs;
  return tail.split(sep).filter((s) => s.length > 0);
}

function errorCode(err: unknown): string | null {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}
