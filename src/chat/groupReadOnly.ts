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
    if (!isGroupable(block, input)) {
      out.push({ kind: 'single', index: i, block });
      i += 1;
      continue;
    }
    const run = collectGroupRun(i, block, input);
    if (run.indices.length >= min) {
      out.push({ kind: 'group', toolName: block.name, indices: run.indices, blocks: run.blocks });
    } else {
      for (const k of run.indices) {
        out.push({ kind: 'single', index: k, block: input.blocks[k]! });
      }
    }
    i = run.next;
  }
  return out;
}

function isGroupable(
  block: ContentBlock,
  input: { isReadOnly: (name: string) => boolean; runState: RunStateSnapshot },
): block is ToolUseBlock {
  if (block.type !== 'tool_use') return false;
  if (!input.isReadOnly(block.name)) return false;
  return statusOf(input.runState, block.id) === 'success';
}

// Walk forward collecting same-name successful read-only tool_use blocks.
function collectGroupRun(
  start: number,
  first: ToolUseBlock,
  input: DetectGroupsInput,
): { indices: number[]; blocks: ToolUseBlock[]; next: number } {
  const indices: number[] = [start];
  const blocks: ToolUseBlock[] = [first];
  let j = start + 1;
  while (j < input.blocks.length) {
    const next = input.blocks[j]!;
    if (next.type !== 'tool_use') break;
    if (next.name !== first.name) break;
    if (!input.isReadOnly(next.name)) break;
    if (statusOf(input.runState, next.id) !== 'success') break;
    indices.push(j);
    blocks.push(next);
    j += 1;
  }
  return { indices, blocks, next: j };
}
