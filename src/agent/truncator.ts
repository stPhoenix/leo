import { estimateTokens } from './tokenCount';
import type { AssembledPromptSegments } from './types';

export interface TruncationResult {
  readonly segments: AssembledPromptSegments;
  readonly dropped: {
    readonly history: number;
    readonly ragHits: number;
  };
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly budget: number;
}

function countSegments(s: AssembledPromptSegments): number {
  let n = 0;
  if (s.activeNote !== null) n += estimateTokens(s.activeNote);
  for (const h of s.ragHits) n += estimateTokens(h.content ?? `${h.path}`);
  for (const m of s.history) n += estimateTokens(m.content);
  if (s.skillListing !== null) n += estimateTokens(s.skillListing.content);
  return n;
}

export function truncate(input: AssembledPromptSegments, budget: number): TruncationResult {
  const tokensBefore = countSegments(input);
  let history = input.history.slice();
  let ragHits = input.ragHits.slice();
  let droppedHistory = 0;
  let droppedRag = 0;

  const tokensNow = (): number =>
    countSegments({
      activeNote: input.activeNote,
      ragHits,
      history,
      skillListing: input.skillListing,
    });

  while (tokensNow() > budget && history.length > 0) {
    history = history.slice(1);
    droppedHistory += 1;
  }
  while (tokensNow() > budget && ragHits.length > 0) {
    ragHits = ragHits.slice(0, -1);
    droppedRag += 1;
  }

  const segments: AssembledPromptSegments = {
    activeNote: input.activeNote,
    ragHits,
    history,
    skillListing: input.skillListing,
  };

  return {
    segments,
    dropped: {
      history: droppedHistory,
      ragHits: droppedRag,
    },
    tokensBefore,
    tokensAfter: countSegments(segments),
    budget,
  };
}
