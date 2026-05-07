export type CompactTrigger = 'manual' | 'auto';

export type CompactPhase =
  | 'idle'
  | 'preparing'
  | 'summarizing'
  | 'building_attachments'
  | 'done'
  | 'cancelled'
  | 'error';

export type CompactErrorCode =
  | 'no_stream'
  | 'no_summary'
  | 'prompt_too_long'
  | 'circuit_broken'
  | 'aborted'
  | 'empty_history'
  | 'reload'
  | 'unknown';

export interface CompactError {
  readonly code: CompactErrorCode;
  readonly message: string;
}

export interface CompactViewModel {
  readonly runId: string;
  readonly threadId: string;
  readonly trigger: CompactTrigger;
  readonly phase: CompactPhase;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly preTokens: number | null;
  readonly postTokens: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly customInstructions: string | null;
  readonly attachmentCount: number | null;
  readonly error: CompactError | null;
}

export const TERMINAL_COMPACT_PHASES: ReadonlySet<CompactPhase> = new Set([
  'done',
  'cancelled',
  'error',
]);

export function makeInitialCompactViewModel(input: {
  runId: string;
  threadId: string;
  trigger: CompactTrigger;
  customInstructions?: string;
}): CompactViewModel {
  return {
    runId: input.runId,
    threadId: input.threadId,
    trigger: input.trigger,
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    preTokens: null,
    postTokens: null,
    inputTokens: null,
    outputTokens: null,
    customInstructions: input.customInstructions ?? null,
    attachmentCount: null,
    error: null,
  };
}

export function isTerminalCompactPhase(phase: CompactPhase): boolean {
  return TERMINAL_COMPACT_PHASES.has(phase);
}
