import type { ExternalEvent } from './adapters/base';

export type ExternalPhase =
  | 'preparing'
  | 'awaiting_clarify'
  | 'ready'
  | 'running'
  | 'writing'
  | 'done'
  | 'cancelled'
  | 'error';

export const TERMINAL_PHASES: readonly ExternalPhase[] = ['done', 'cancelled', 'error'];

export interface RefineMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}

export interface PendingFile {
  readonly relPath: string;
  readonly content: string | Uint8Array;
  readonly mime?: string;
}

export interface LogEvent {
  readonly level: 'debug' | 'info' | 'warn';
  readonly msg: string;
  readonly ts: number;
}

export interface ExternalAgentState {
  readonly runId: string;
  readonly threadId: string;
  readonly phase: ExternalPhase;

  readonly originalAsk: string;
  readonly refineHistory: readonly RefineMessage[];
  readonly refineIterations: number;
  readonly refineBudget: number;
  readonly refinedPrompt: string | null;
  readonly clarifyingQuestion: string | null;

  readonly selectedAdapterId: string | null;
  readonly timeoutMs: number;
  readonly startedAt: number | null;
  readonly endedAt: number | null;

  readonly textBuffer: string;
  readonly pendingFiles: readonly PendingFile[];
  readonly logEvents: readonly LogEvent[];

  readonly resultFolder: string | null;
  readonly writtenFiles: readonly string[];
  readonly error: { readonly code: string; readonly message: string } | null;
}

export function isTerminal(phase: ExternalPhase): boolean {
  return phase === 'done' || phase === 'cancelled' || phase === 'error';
}

export function initialState(input: {
  runId: string;
  threadId: string;
  originalAsk: string;
  refineBudget: number;
  selectedAdapterId: string | null;
  timeoutMs: number;
}): ExternalAgentState {
  return {
    runId: input.runId,
    threadId: input.threadId,
    phase: 'preparing',
    originalAsk: input.originalAsk,
    refineHistory: [],
    refineIterations: 0,
    refineBudget: input.refineBudget,
    refinedPrompt: null,
    clarifyingQuestion: null,
    selectedAdapterId: input.selectedAdapterId,
    timeoutMs: input.timeoutMs,
    startedAt: null,
    endedAt: null,
    textBuffer: '',
    pendingFiles: [],
    logEvents: [],
    resultFolder: null,
    writtenFiles: [],
    error: null,
  };
}

export interface AppendEventOptions {
  readonly ts: () => number;
}

export function applyExternalEvent(
  state: ExternalAgentState,
  event: ExternalEvent,
  opts: AppendEventOptions = { ts: () => Date.now() },
): ExternalAgentState {
  switch (event.type) {
    case 'text':
      return { ...state, textBuffer: state.textBuffer + event.chunk };
    case 'log':
      return {
        ...state,
        logEvents: [...state.logEvents, { level: event.level, msg: event.msg, ts: opts.ts() }],
      };
    case 'file':
      return {
        ...state,
        pendingFiles: [
          ...state.pendingFiles,
          {
            relPath: event.relPath,
            content: event.content,
            ...(event.mime !== undefined ? { mime: event.mime } : {}),
          },
        ],
      };
    case 'done':
    case 'error':
      return state;
  }
}
