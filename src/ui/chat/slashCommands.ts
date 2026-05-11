import type { Logger } from '@/platform/Logger';

export interface SlashContext {
  readonly raw: string;
  readonly name: string;
  readonly args: string;
}

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
  readonly match?: (ctx: SlashContext) => boolean;
  readonly run: (ctx: SlashContext) => void | Promise<void>;
}

export interface SlashCommandInfo {
  readonly name: string;
  readonly description: string;
}

export interface SlashRegistry {
  register(cmd: SlashCommand): void;
  tryHandle(text: string): boolean;
  list(): readonly SlashCommandInfo[];
}

const SLASH_REGEX =
  /^\s*\/([A-Za-z][A-Za-z0-9_-]*(?::[A-Za-z][A-Za-z0-9_-]*)?)(?:\s+([\s\S]*?))?\s*$/; // NOSONAR(typescript:S5852): anchored, bounded segments, optional single `:`-suffix, lazy arg capture bounded by `\s*$`, linear.

export function parseSlashInput(text: string): SlashContext | null {
  const m = SLASH_REGEX.exec(text);
  if (m === null) return null;
  return {
    raw: text,
    name: m[1]!.toLowerCase(),
    args: (m[2] ?? '').trim(),
  };
}

export interface SlashRegistryOptions {
  readonly logger?: Logger;
  readonly onError?: (err: Error, ctx: SlashContext) => void;
}

export function createSlashRegistry(opts: SlashRegistryOptions = {}): SlashRegistry {
  const byName = new Map<string, SlashCommand>();

  const defaultMatch = (cmd: SlashCommand, ctx: SlashContext): boolean =>
    cmd.name === ctx.name && ctx.args.length === 0;

  return {
    register(cmd) {
      const key = cmd.name.toLowerCase();
      if (byName.has(key)) {
        throw new Error(`slash command already registered: ${cmd.name}`);
      }
      byName.set(key, cmd);
    },
    list() {
      const out: SlashCommandInfo[] = [];
      for (const cmd of byName.values()) {
        out.push({ name: cmd.name, description: cmd.description });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    },
    tryHandle(text) {
      const ctx = parseSlashInput(text);
      if (ctx === null) return false;
      const cmd = byName.get(ctx.name);
      if (cmd === undefined) return false;
      const matches = cmd.match !== undefined ? cmd.match(ctx) : defaultMatch(cmd, ctx);
      if (!matches) return false;
      void Promise.resolve()
        .then(() => cmd.run(ctx))
        .catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          opts.logger?.warn('slash.run.failed', { name: ctx.name, error: error.message });
          opts.onError?.(error, ctx);
        });
      return true;
    },
  };
}
