import type { ContentBlock, ToolResultBlock, ToolUseBlock } from './types';
import type { RunStateSnapshot } from './runStateStore';
import { statusOf } from './runStateStore';

export interface GroupedToolPair {
  readonly toolUse: ToolUseBlock;
  readonly toolUseIndex: number;
  readonly result?: ToolResultBlock;
  readonly resultIndex?: number;
}

export type GroupingSegment =
  | { readonly kind: 'single'; readonly index: number; readonly block: ContentBlock }
  | {
      readonly kind: 'group';
      readonly toolName: string;
      readonly indices: readonly number[];
      readonly pairs: readonly GroupedToolPair[];
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
    if (run.pairs.length >= min) {
      out.push({ kind: 'group', toolName: block.name, indices: run.indices, pairs: run.pairs });
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

// Walk forward collecting same-name successful read-only tool_use blocks plus
// their immediately-following matching tool_result block (when present).
function collectGroupRun(
  start: number,
  first: ToolUseBlock,
  input: DetectGroupsInput,
): { indices: number[]; pairs: GroupedToolPair[]; next: number } {
  const indices: number[] = [];
  const pairs: GroupedToolPair[] = [];
  let j = start;
  while (j < input.blocks.length) {
    const next = input.blocks[j]!;
    if (next.type !== 'tool_use') break;
    if (next.name !== first.name) break;
    if (!input.isReadOnly(next.name)) break;
    if (statusOf(input.runState, next.id) !== 'success') break;
    const toolUseIndex = j;
    indices.push(toolUseIndex);
    j += 1;
    let result: ToolResultBlock | undefined;
    let resultIndex: number | undefined;
    const maybeResult = input.blocks[j];
    if (maybeResult?.type === 'tool_result' && maybeResult.tool_use_id === next.id) {
      result = maybeResult;
      resultIndex = j;
      indices.push(j);
      j += 1;
    }
    pairs.push({
      toolUse: next,
      toolUseIndex,
      ...(result !== undefined ? { result } : {}),
      ...(resultIndex !== undefined ? { resultIndex } : {}),
    });
  }
  return { indices, pairs, next: j };
}
