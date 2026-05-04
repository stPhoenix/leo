import type { ContentBlock } from '@/chat/types';

export interface MessageWithBlocks {
  readonly blocks?: readonly ContentBlock[];
}

export function extractDiscoveredToolNamesFromHistory(
  messages: readonly MessageWithBlocks[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const msg of messages) {
    const blocks = msg.blocks;
    if (blocks === undefined) continue;
    for (const block of blocks) {
      if (block.type === 'tool_reference') {
        out.add(block.tool_name);
        continue;
      }
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        for (const inner of block.content) {
          if (inner.type === 'tool_reference') out.add(inner.tool_name);
        }
      }
    }
  }
  return out;
}

export function mergeDiscovered(
  base: ReadonlySet<string>,
  added: Iterable<string>,
): ReadonlySet<string> {
  const out = new Set(base);
  let changed = false;
  for (const name of added) {
    if (!out.has(name)) {
      out.add(name);
      changed = true;
    }
  }
  return changed ? out : base;
}
