import type { ContentBlock, ToolUseBlock } from './types';
import type { RunStateSnapshot } from './runStateStore';
import { statusOf } from './runStateStore';

export type GroupingSegment =
  | { readonly kind: 'single'; readonly index: number; readonly block: ContentBlock }
  | {
      readonly kind: 'group';
      readonly toolName: string;
      readonly indices: readonly number[];
      readonly blocks: readonly ToolUseBlock[];
    };

export interface DetectGroupsInput {
  readonly blocks: readonly ContentBlock[];
  readonly runState: RunStateSnapshot;
  readonly isReadOnly: (toolName: string) => boolean;
  readonly minGroupSize?: number;
}

export function detectGroups(input: DetectGroupsInput): readonly GroupingSegment[] {
  const min = input.minGroupSize ?? 2;
  const out: GroupingSegment[] = [];
  let i = 0;
  while (i < input.blocks.length) {
    const block = input.blocks[i]!;
    if (block.type !== 'tool_use') {
      out.push({ kind: 'single', index: i, block });
      i += 1;
      continue;
    }
    if (!input.isReadOnly(block.name)) {
      out.push({ kind: 'single', index: i, block });
      i += 1;
      continue;
    }
    const status = statusOf(input.runState, block.id);
    if (status !== 'success') {
      out.push({ kind: 'single', index: i, block });
      i += 1;
      continue;
    }
    // Walk forward collecting same-name successful read-only tool_use blocks.
    const indices: number[] = [i];
    const blocks: ToolUseBlock[] = [block];
    let j = i + 1;
    while (j < input.blocks.length) {
      const next = input.blocks[j]!;
      if (next.type !== 'tool_use') break;
      if (next.name !== block.name) break;
      if (!input.isReadOnly(next.name)) break;
      if (statusOf(input.runState, next.id) !== 'success') break;
      indices.push(j);
      blocks.push(next);
      j += 1;
    }
    if (indices.length >= min) {
      out.push({ kind: 'group', toolName: block.name, indices, blocks });
    } else {
      for (const k of indices) {
        out.push({ kind: 'single', index: k, block: input.blocks[k]! });
      }
    }
    i = j;
  }
  return out;
}
