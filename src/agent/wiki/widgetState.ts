import type { WikiOp } from '@/agent/wiki/mutexTypes';
import type { ProviderKind } from '@/settings/settingsStore';
import type { ProviderModel } from '@/providers/types';

export type WikiPhase =
  | 'idle'
  | 'awaiting_config'
  | 'preparing'
  | 'awaiting_clarify'
  | 'fetching'
  | 'persisting'
  | 'awaiting_duplicate'
  | 'planning'
  | 'extracting'
  | 'reducing'
  | 'awaiting_confirm'
  | 'writing'
  | 'scanning'
  | 'checking'
  | 'proposing'
  | 'done'
  | 'cancelled'
  | 'error';

export type WikiModelsState =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly items: readonly ProviderModel[] }
  | { readonly state: 'error'; readonly error: string };

export interface WikiConfigDraft {
  readonly providers: readonly ProviderKind[];
  readonly draftProviderId: ProviderKind;
  readonly draftModel: string;
  readonly models: WikiModelsState;
  readonly defaultProviderId: ProviderKind;
  readonly defaultModel: string;
  readonly apiKeyMissing: boolean;
  readonly validationError: string | null;
  readonly originalAsk: string;
  readonly sourcesSummary: string;
}

export const TERMINAL_WIKI_PHASES: ReadonlySet<WikiPhase> = new Set(['done', 'cancelled', 'error']);

export interface RefineTurn {
  readonly role: 'assistant' | 'user';
  readonly content: string;
}

export interface ProgressCounts {
  readonly total: number;
  readonly completed: number;
  readonly failed?: number;
  readonly current?: string;
}

export interface DuplicatePrompt {
  readonly sourceRef: string;
  readonly rawPath: string;
}

export interface PlanSourceSummary {
  readonly rawPath: string;
  readonly candidatePages: readonly string[];
}

export interface LintFindingSummary {
  readonly id: string;
  readonly page: string;
  readonly action: string;
  readonly severity: 'info' | 'warn' | 'error';
  readonly rationale: string;
  readonly accepted: boolean | null;
}

export interface PerSourceStatus {
  readonly rawPath: string;
  readonly status: 'ok' | 'skipped' | 'replaced' | 'error';
  readonly error?: string;
}

export interface WikiViewModel {
  readonly runId: string;
  readonly threadId: string;
  readonly op: WikiOp;
  readonly phase: WikiPhase;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly logCount: number;
  readonly logLine: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;

  // AWAITING_CONFIG
  readonly config?: WikiConfigDraft;

  // PREPARING / awaiting_clarify
  readonly refineTranscript?: readonly RefineTurn[];
  readonly clarifyingQuestion?: string | null;

  // FETCHING / PERSISTING
  readonly fetchProgress?: ProgressCounts;
  readonly persistProgress?: ProgressCounts;
  readonly duplicatePrompt?: DuplicatePrompt | null;

  // PLANNING
  readonly plan?: { readonly perSource: readonly PlanSourceSummary[] };

  // EXTRACTING / REDUCING
  readonly extractProgress?: ProgressCounts;
  readonly reduceProgress?: ProgressCounts;

  // WRITING
  readonly writeProgress?: ProgressCounts;
  readonly writtenFiles?: readonly string[];
  readonly pagesCreated?: number;
  readonly pagesEdited?: number;

  // LINT phases
  readonly scanSummary?: {
    readonly pages: number;
    readonly sources: number;
    readonly orphanPages: number;
    readonly orphanRaw: number;
  };
  readonly checkProgress?: ProgressCounts;
  readonly findings?: readonly LintFindingSummary[];
  readonly schemaPatchPending?: boolean;

  // Terminal
  readonly perSourceStatuses?: readonly PerSourceStatus[];
}

export function makeInitialViewModel(input: {
  runId: string;
  threadId: string;
  op: WikiOp;
}): WikiViewModel {
  return {
    runId: input.runId,
    threadId: input.threadId,
    op: input.op,
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    logCount: 0,
    logLine: null,
    error: null,
  };
}

export function isTerminal(phase: WikiPhase): boolean {
  return TERMINAL_WIKI_PHASES.has(phase);
}
