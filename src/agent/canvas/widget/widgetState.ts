import type { CanvasOp } from '@/agent/canvas/mutex';
import type { CanvasPhase, CanvasFailedSource, CanvasErrorPayload } from '@/agent/canvas/state';
import type { ProviderKind } from '@/settings/settingsStore';
import type { ProviderModel } from '@/providers/types';
import type { LayoutHint } from '@/agent/canvas/schemas';
import type { Insights } from '@/agent/canvas/schemas';
import type { CanvasPaletteId } from '@/agent/canvas/layouts/colorPalette';

export type { CanvasPhase } from '@/agent/canvas/state';

export const TERMINAL_CANVAS_PHASES: ReadonlySet<CanvasPhase> = new Set([
  'done',
  'cancelled',
  'error',
]);

export type CanvasModelsState =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly items: readonly ProviderModel[] }
  | { readonly state: 'error'; readonly error: string };

export interface CanvasConfigDraft {
  readonly providers: readonly ProviderKind[];
  readonly draftProviderId: ProviderKind;
  readonly draftModel: string;
  readonly draftPreset: LayoutHint;
  readonly draftPath: string;
  readonly draftPaletteId: CanvasPaletteId;
  readonly models: CanvasModelsState;
  readonly defaultProviderId: ProviderKind;
  readonly defaultModel: string;
  readonly defaultPreset: LayoutHint;
  readonly defaultPath: string;
  readonly defaultPaletteId: CanvasPaletteId;
  readonly apiKeyMissing: boolean;
  readonly validationError: string | null;
  readonly originalAsk: string;
}

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

export interface DiffSummary {
  readonly kept: number;
  readonly added: number;
  readonly removed: number;
  readonly locked: number;
}

export interface CanvasViewModel {
  readonly runId: string;
  readonly threadId: string;
  readonly op: CanvasOp;
  readonly phase: CanvasPhase;
  readonly targetPath: string;
  readonly originalAsk: string;
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly logCount: number;
  readonly logLine: string | null;
  readonly error: CanvasErrorPayload | null;

  // AWAITING_CONFIG
  readonly config?: CanvasConfigDraft;

  // PREPARING
  readonly refineTranscript?: readonly RefineTurn[];
  readonly clarifyingQuestion?: string | null;
  readonly editInstruction?: string;

  // PLANNING / FETCHING / EXTRACTING
  readonly fetchProgress?: ProgressCounts;
  readonly extractProgress?: ProgressCounts;
  readonly failedSources?: readonly CanvasFailedSource[];

  // REDUCING
  readonly insights?: Insights;

  // DIFFING
  readonly diffSummary?: DiffSummary;
  readonly tombstoneSummary?: string;

  // LAYING_OUT
  readonly preset?: LayoutHint;
  readonly fellBackTo?: string;
  readonly paletteId?: CanvasPaletteId;

  // PREVIEWING
  readonly previewPath?: string;

  // WRITING
  readonly writeProgress?: ProgressCounts;
}

export function makeInitialCanvasViewModel(input: {
  runId: string;
  threadId: string;
  op: CanvasOp;
  targetPath: string;
  originalAsk: string;
  phase?: CanvasPhase;
}): CanvasViewModel {
  return {
    runId: input.runId,
    threadId: input.threadId,
    op: input.op,
    phase: input.phase ?? 'awaiting_config',
    targetPath: input.targetPath,
    originalAsk: input.originalAsk,
    startedAt: null,
    endedAt: null,
    logCount: 0,
    logLine: null,
    error: null,
  };
}

export function isTerminalCanvasPhase(phase: CanvasPhase): boolean {
  return TERMINAL_CANVAS_PHASES.has(phase);
}
