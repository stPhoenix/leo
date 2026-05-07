import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import type { RunHandle } from '@/agent/externalAgent/subgraph';
import type { DelegateExternalToolResult } from '@/agent/externalAgent/runPhase';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import type { FetchResult, FetchedSource } from './types';
import type { UrlFetcher } from './fetchSource';

const RESPONSE_FILENAME = 'response.md';

export interface OrchestratorUrlFetcherDeps {
  readonly orchestrator: ExternalAgentOrchestrator;
  readonly vault: VaultAdapter;
  /** Chat threadId where the per-URL `delegate_external` widget should appear. */
  readonly threadId: () => string;
  /** Hook to register live widget controller + append widget block to chat. */
  readonly onHandle?: (handle: RunHandle) => void;
  readonly logger?: Logger;
  readonly originalAskBuilder?: (url: string) => string;
}

const DEFAULT_ORIGINAL_ASK = (url: string): string =>
  `Fetch ${url} using fetch_url. Return the response body verbatim, no commentary, no summarization.`;

/**
 * URL fetcher that routes every URL through `delegate_external` (the
 * inlineAgent adapter). Each URL fires one orchestrator run. The user picks
 * adapter + reviews refined prompt + clicks Send via the inline external-agent
 * widget. After terminal, this reads `<folder>/response.md` (the agent's
 * verbatim assistant text — same content the result writer dumped) and returns
 * it as the source body.
 */
export function createOrchestratorUrlFetcher(deps: OrchestratorUrlFetcherDeps): UrlFetcher {
  const buildAsk = deps.originalAskBuilder ?? DEFAULT_ORIGINAL_ASK;
  return {
    async fetch(url: string, signal: AbortSignal): Promise<FetchResult> {
      if (signal.aborted) {
        return { ok: false, error: { code: 'fetch_failed', message: 'aborted' } };
      }
      const start = deps.orchestrator.start({
        threadId: deps.threadId(),
        originalAsk: buildAsk(url),
      });
      if (!start.ok) {
        deps.logger?.warn(WIKI_LOG.ingest.fetch.failed, {
          url,
          code: 'fetch_failed',
          reason: 'external_agent_busy',
          activeRunId: start.activeRunId,
        });
        return {
          ok: false,
          error: {
            code: 'fetch_failed',
            message: `delegate_external slot busy (activeRunId=${start.activeRunId})`,
          },
        };
      }
      deps.onHandle?.(start.handle);

      const onAbort = (): void => start.handle.cancel();
      signal.addEventListener('abort', onAbort, { once: true });

      let terminal: DelegateExternalToolResult;
      try {
        terminal = await start.terminal;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }

      if (!terminal.ok) {
        if ('cancelled' in terminal) {
          return {
            ok: false,
            error: { code: 'fetch_failed', message: `cancelled in phase ${terminal.phase}` },
          };
        }
        return {
          ok: false,
          error: {
            code: 'fetch_failed',
            message: `external-agent error: ${terminal.error.code}: ${terminal.error.message}`,
          },
        };
      }

      const responsePath = `${terminal.folder}/${RESPONSE_FILENAME}`;
      let body: string;
      try {
        body = await deps.vault.read(responsePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: {
            code: 'fetch_failed',
            message: `failed reading ${responsePath}: ${message}`,
          },
        };
      }

      const fetched: FetchedSource = {
        sourceRef: url,
        originalPath: null,
        contentType: 'text/markdown',
        body,
        bytes: byteLength(body),
      };
      deps.logger?.debug(WIKI_LOG.ingest.fetch.ok, {
        url,
        bytes: fetched.bytes,
        runId: start.handle.runId,
        folder: terminal.folder,
      });
      return { ok: true, fetched };
    },
  };
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return text.length;
}
