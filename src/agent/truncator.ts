import { estimateTokens } from './tokenCount';
import type { AssembledPromptSegments } from './types';

export interface TruncationResult {
  readonly segments: AssembledPromptSegments;
  readonly dropped: {
    readonly skillExamples: number;
    readonly history: number;
    readonly ragHits: number;
  };
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly budget: number;
}

function countSegments(s: AssembledPromptSegments): number {
  let n = estimateTokens(s.skillSystem);
  if (s.activeNote !== null) n += estimateTokens(s.activeNote);
  for (const h of s.ragHits) n += estimateTokens(h.content ?? `${h.path}`);
  for (const m of s.history) n += estimateTokens(m.content);
  for (const e of s.skillExamples) n += estimateTokens(e);
  return n;
}

export function truncate(input: AssembledPromptSegments, budget: number): TruncationResult {
  const tokensBefore = countSegments(input);
  let skillExamples = input.skillExamples.slice();
  let history = input.history.slice();
  let ragHits = input.ragHits.slice();
  let droppedExamples = 0;
  let droppedHistory = 0;
  let droppedRag = 0;

  const tokensNow = (): number =>
    countSegments({
      skillSystem: input.skillSystem,
      activeNote: input.activeNote,
      ragHits,
      history,
      skillExamples,
    });

  while (tokensNow() > budget && skillExamples.length > 0) {
    skillExamples = skillExamples.slice(0, -1);
    droppedExamples += 1;
  }
  while (tokensNow() > budget && history.length > 0) {
    history = history.slice(1);
    droppedHistory += 1;
  }
  while (tokensNow() > budget && ragHits.length > 0) {
    ragHits = ragHits.slice(0, -1);
    droppedRag += 1;
  }

  const segments: AssembledPromptSegments = {
    skillSystem: input.skillSystem,
    activeNote: input.activeNote,
    ragHits,
    history,
    skillExamples,
  };

  return {
    segments,
    dropped: {
      skillExamples: droppedExamples,
      history: droppedHistory,
      ragHits: droppedRag,
    },
    tokensBefore,
    tokensAfter: countSegments(segments),
    budget,
  };
}
