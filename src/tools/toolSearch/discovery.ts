import type { ContentBlock } from '@/chat/types';

export interface MessageWithBlocks {
  readonly blocks?: readonly ContentBlock[];
}

function collectToolNamesFromBlock(block: ContentBlock, out: Set<string>): void {
  if (block.type === 'tool_reference') {
    out.add(block.tool_name);
    return;
  }
  if (block.type !== 'tool_result' || !Array.isArray(block.content)) return;
  for (const inner of block.content) {
    if (inner.type === 'tool_reference') out.add(inner.tool_name);
  }
}

export function extractDiscoveredToolNamesFromHistory(
  messages: readonly MessageWithBlocks[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const msg of messages) {
    if (msg.blocks === undefined) continue;
    for (const block of msg.blocks) collectToolNamesFromBlock(block, out);
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
