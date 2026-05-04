import { WIKI_RUN_DEFAULTS } from '@/agent/wiki/budgets';
import type { DuplicateChoice, DuplicateMatch } from './types';

export interface DuplicatePromptDeps {
  /**
   * Surface the duplicate prompt and resolve once the user picks a choice. F11
   * (subgraph driver) wires this to the F06 widget controller, which wires it
   * to LangGraph `interrupt()`.
   */
  readonly request: (match: DuplicateMatch) => Promise<DuplicateChoice | null>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/**
 * Resolve the user's duplicate-detect choice with a default-to-Skip after
 * `reingestPromptTimeoutMs` (60 s default per FR-41). Returns the user's
 * choice, or `'skip'` on timeout / abort / null response.
 */
export async function resolveDuplicateChoice(
  match: DuplicateMatch,
  deps: DuplicatePromptDeps,
): Promise<DuplicateChoice> {
  const timeoutMs = deps.timeoutMs ?? WIKI_RUN_DEFAULTS.reingestPromptTimeoutMs;
  return new Promise<DuplicateChoice>((resolve) => {
    let settled = false;
    const finish = (choice: DuplicateChoice): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (deps.signal !== undefined) deps.signal.removeEventListener('abort', onAbort);
      resolve(choice);
    };
    const timer = setTimeout(() => finish('skip'), timeoutMs);
    const onAbort = (): void => finish('skip');
    if (deps.signal?.aborted === true) {
      finish('skip');
      return;
    }
    if (deps.signal !== undefined) deps.signal.addEventListener('abort', onAbort);
    void Promise.resolve()
      .then(() => deps.request(match))
      .then((choice) => finish(choice ?? 'skip'))
      .catch(() => finish('skip'));
  });
}
