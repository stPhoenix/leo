import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ToolSpec } from '../types';
import { loadUserTools, USER_TOOLS_DIR, type ToolRegistryLike } from './userToolsLoader';

export type UserToolEventKind = 'create' | 'modify' | 'delete' | 'rename';

export interface UserToolsFileEvents {
  on(cb: (path: string, kind: UserToolEventKind) => void): () => void;
}

export interface UserToolsCommandRegistrar {
  register(id: string, name: string, run: () => void | Promise<void>): void;
}

export interface UserToolsRegistry extends ToolRegistryLike {
  unregister(id: string): boolean;
}

export interface WireUserToolsOptions {
  readonly vault: VaultAdapter;
  readonly toolRegistry: UserToolsRegistry;
  readonly logger?: Logger;
  readonly notice?: { notify(message: string): void };
  readonly fileEvents?: UserToolsFileEvents;
  readonly commands?: UserToolsCommandRegistrar;
  readonly dir?: string;
  readonly jsContext?: Record<string, unknown>;
}

export interface UserToolsWiring {
  readonly dir: string;
  registeredIds(): readonly string[];
  reload(): Promise<number>;
  dispose(): void;
}

export const USER_TOOLS_RELOAD_COMMAND_ID = 'leo-reload-user-tools';

export async function wireUserTools(opts: WireUserToolsOptions): Promise<UserToolsWiring> {
  const dir = opts.dir ?? USER_TOOLS_DIR;
  const tracked = new Set<string>();

  const trackingRegistry: ToolRegistryLike = {
    register(spec: ToolSpec<unknown, unknown>): void {
      opts.toolRegistry.register(spec);
      tracked.add(spec.id);
    },
    lookup(id: string): ToolSpec<unknown, unknown> | undefined {
      return opts.toolRegistry.lookup(id);
    },
  };

  const doReload = async (): Promise<number> => {
    for (const id of tracked) opts.toolRegistry.unregister(id);
    tracked.clear();
    const loadArgs = {
      vault: opts.vault,
      registry: trackingRegistry,
      dir,
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
      ...(opts.notice !== undefined ? { notice: opts.notice } : {}),
      ...(opts.jsContext !== undefined ? { jsContext: opts.jsContext } : {}),
    };
    return loadUserTools(loadArgs);
  };

  let reloadChain: Promise<unknown> = Promise.resolve();
  const reload = (): Promise<number> => {
    const next = reloadChain.then(() => doReload());
    reloadChain = next.catch(() => undefined);
    return next;
  };

  await reload();

  let offEvents: (() => void) | null = null;
  if (opts.fileEvents !== undefined) {
    offEvents = opts.fileEvents.on((path) => {
      if (!isUnderDir(path, dir)) return;
      reload().catch((err) => {
        opts.logger?.warn('tool.user.reload.error', {
          path,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  opts.commands?.register(USER_TOOLS_RELOAD_COMMAND_ID, 'Leo: Reload user tools', async () => {
    try {
      const n = await reload();
      opts.notice?.notify(`Leo: user tools reloaded (${n}).`);
    } catch (err) {
      opts.logger?.warn('tool.user.reload.error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return {
    dir,
    registeredIds: () => [...tracked],
    reload,
    dispose: () => {
      offEvents?.();
      offEvents = null;
      for (const id of tracked) opts.toolRegistry.unregister(id);
      tracked.clear();
    },
  };
}

function isUnderDir(path: string, dir: string): boolean {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return path === dir || path.startsWith(prefix);
}
