import type { CanvasJson } from './canvasJson';
import type { CanvasOp } from './mutex';
import type { DiffResult } from './diff';
import type { CanvasPaletteId } from './layouts/colorPalette';
import type { EntityGraph, Insights, RunPlan, SidecarV1 } from './schemas';
import type { FetchedCanvasItem } from './fetch';
import type { CanvasSourceItem } from './plan';
import type { ExtractorOutput } from './schemas';
import type { CanvasNavigatorWarning } from '@/editor/canvasNavigator';

export type CanvasPhase =
  | 'awaiting_config'
  | 'preparing'
  | 'planning'
  | 'fetching'
  | 'extracting'
  | 'reducing'
  | 'diffing'
  | 'laying_out'
  | 'previewing'
  | 'writing'
  | 'done'
  | 'cancelled'
  | 'error';

export interface CanvasFailedSource {
  readonly ref: string;
  readonly code: string;
  readonly message: string;
}

export interface CanvasPartial {
  readonly fetchedSources?: readonly string[];
  readonly extractedSources?: readonly string[];
  readonly previewPath?: string;
  readonly failedSources?: readonly CanvasFailedSource[];
}

export interface CanvasErrorPayload {
  readonly code: string;
  readonly message: string;
}

export interface CanvasTerminalState {
  readonly phase: 'done' | 'cancelled' | 'error';
  readonly runId: string;
  readonly path: string;
  readonly op: CanvasOp;
  readonly insights?: Insights;
  readonly partial?: CanvasPartial;
  readonly error?: CanvasErrorPayload;
  readonly warning?: CanvasNavigatorWarning | string;
  readonly durationMs: number;
  readonly paletteId: CanvasPaletteId;
}

export interface CanvasState {
  readonly runId: string;
  readonly threadId: string;
  readonly op: CanvasOp;
  readonly originalAsk: string;
  readonly targetPath: string;
  readonly phase: CanvasPhase;
  readonly editIterations: number;
  readonly questionCount: number;
  readonly refineHistory: readonly { role: 'user' | 'assistant' | 'tool'; content: string }[];
  readonly runPlan: RunPlan | null;
  readonly sources: readonly CanvasSourceItem[];
  readonly fetched: readonly FetchedCanvasItem[];
  readonly extractorOutputs: ReadonlyMap<string, ExtractorOutput>;
  readonly extractorErrors: readonly CanvasFailedSource[];
  readonly graph: EntityGraph | null;
  readonly insights: Insights | null;
  readonly diff: DiffResult | null;
  readonly canvasJson: CanvasJson | null;
  readonly previewPath: string | null;
  readonly sidecar: SidecarV1 | null;
  readonly tombstoneSummary: string | undefined;
  readonly fellBackTo: string | undefined;
  readonly paletteId: CanvasPaletteId;
}

export type EditAction =
  | { readonly kind: 'approve' }
  | { readonly kind: 'edit'; readonly instruction: string }
  | { readonly kind: 'cancel' };

export interface PreviewingDecisionAdapter {
  awaitDecision(state: CanvasState): Promise<EditAction>;
}

export type PartialState = Partial<CanvasState>;
