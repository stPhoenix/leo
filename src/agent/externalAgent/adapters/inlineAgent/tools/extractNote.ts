import { extractNoteInputSchema, type ExtractNoteInput } from './schemas';
import {
  appendNote,
  NOTE_SUMMARY_MAX_BYTES,
  type InlineAgentRunState,
  type NoteRecord,
} from '../runState';
import type { InlineAgentLoggerLite } from '../eventBridge';

export const NOTE_LIMIT_DEFAULT = 128;

export type ExtractNoteResult =
  | {
      readonly ok: true;
      readonly data: { readonly id: string; readonly noteCount: number };
    }
  | {
      readonly ok: false;
      readonly error: 'summary_too_large' | 'note_limit' | 'invalid_args';
    };

export interface ExtractNoteCtx {
  readonly runState: InlineAgentRunState;
  readonly logger: InlineAgentLoggerLite;
  readonly noteLimit?: number;
  readonly now?: () => number;
}

export interface ExtractNoteTool {
  readonly name: 'extract_note';
  invoke(input: unknown): Promise<ExtractNoteResult>;
}

export function createExtractNoteTool(ctx: ExtractNoteCtx): ExtractNoteTool {
  const noteLimit = ctx.noteLimit ?? NOTE_LIMIT_DEFAULT;
  const now = ctx.now ?? ((): number => Date.now());
  return {
    name: 'extract_note',
    async invoke(input): Promise<ExtractNoteResult> {
      let parsed: ExtractNoteInput;
      try {
        parsed = extractNoteInputSchema.parse(input);
      } catch {
        return { ok: false, error: 'invalid_args' };
      }
      const summaryBytes = Buffer.byteLength(parsed.summary, 'utf8');
      if (summaryBytes > NOTE_SUMMARY_MAX_BYTES) {
        return { ok: false, error: 'summary_too_large' };
      }
      if (ctx.runState.notes.length >= noteLimit) {
        return { ok: false, error: 'note_limit' };
      }
      const id = `n${ctx.runState.notes.length + 1}`;
      const record: NoteRecord = {
        id,
        stepIndex: ctx.runState.currentStep ?? null,
        ...(parsed.sourceUrl !== undefined ? { sourceUrl: parsed.sourceUrl } : {}),
        title: parsed.title,
        summary: parsed.summary,
        relevance: parsed.relevance,
        createdAt: now(),
      };
      try {
        appendNote(ctx.runState, record);
      } catch {
        return { ok: false, error: 'summary_too_large' };
      }
      return {
        ok: true,
        data: { id, noteCount: ctx.runState.notes.length },
      };
    },
  };
}
