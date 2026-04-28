import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { EditNoteBridge } from '@/tools/types';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { ToolSpec } from '@/tools/types';
import { ToolRegistry } from '@/tools/toolRegistry';

export class InMemoryVault implements VaultAdapter {
  readonly files = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(path, content);
    }
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  async write(p: string, data: string): Promise<void> {
    this.files.set(p, data);
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from);
    if (v === undefined) throw new Error(`ENOENT: ${from}`);
    this.files.delete(from);
    this.files.set(to, v);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(_p: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

export function inactiveBridge(): EditNoteBridge {
  return {
    isActiveNote: () => false,
    applyActiveEdit: async () => ({ ok: false, error: 'no active editor' }),
  };
}

export function silentLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {
      /* no-op */
    },
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    log: () => undefined,
  };
  const logger = new Logger({ level: 'warn', sink, consoleImpl });
  return { logger, records };
}

export interface ToolInvocationRecord {
  readonly id: string;
  readonly args: unknown;
}

export function spyingRegistry(specs: readonly ToolSpec<unknown, unknown>[]): {
  registry: ToolRegistry;
  calls: ToolInvocationRecord[];
} {
  const calls: ToolInvocationRecord[] = [];
  const registry = new ToolRegistry();
  for (const spec of specs) {
    registry.register(wrap(spec, calls));
  }
  return { registry, calls };
}

function wrap(
  spec: ToolSpec<unknown, unknown>,
  calls: ToolInvocationRecord[],
): ToolSpec<unknown, unknown> {
  return {
    ...spec,
    async invoke(args, ctx) {
      calls.push({ id: spec.id, args });
      return spec.invoke(args, ctx);
    },
  };
}
