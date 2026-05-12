import { memo, useSyncExternalStore } from 'react';
import type {
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '@/chat/types';
import { detectGroups } from '@/chat/groupReadOnly';
import { EMPTY_RUN_STATE } from '@/chat/runStateStore';
import type { MarkdownRenderFn } from '../MessageList';
import type { CodeBlockClipboard } from '../codeBlockEnhancer';
import { TextBlockView } from './TextBlockView';
import { ThinkingBlockView } from './ThinkingBlockView';
import { ToolUseBlockView, type ToolUseBlockSlots } from './ToolUseBlockView';
import { ToolResultBlockView } from './ToolResultBlockView';
import { GroupedToolUses } from './GroupedToolUses';

const DEFAULT_READ_ONLY = new Set(['readNote', 'searchVault', 'listNotes', 'Read', 'Grep']);

export interface AssistantBlocksProps {
  readonly messageId: string;
  readonly blocks: readonly ContentBlock[];
  readonly streaming: boolean;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly toolUseSlots?: ToolUseBlockSlots;
}

export function AssistantBlocks(props: AssistantBlocksProps): JSX.Element {
  const { blocks, messageId, streaming } = props;
  const lastIndex = blocks.length - 1;
  const toolUseById = new Map<string, ToolUseBlock>();
  for (const b of blocks) {
    if (b.type === 'tool_use') toolUseById.set(b.id, b);
  }
  const runStateSnapshot = useRunStateSnapshot(props.toolUseSlots);
  const isReadOnly = (name: string): boolean => DEFAULT_READ_ONLY.has(name);
  const groups = detectGroups({ blocks, runState: runStateSnapshot, isReadOnly });

  return (
    <div className="leo-assistant-blocks" data-slot="assistant-blocks">
      {groups.map((seg, segIdx) => {
        if (seg.kind === 'group') {
          const key = `${messageId}:group:${segIdx}`;
          return (
            <div key={key} className="leo-assistant-block leo-assistant-block-group">
              <GroupedToolUses
                toolName={seg.toolName}
                pairs={seg.pairs}
                {...(props.toolUseSlots !== undefined ? { slots: props.toolUseSlots } : {})}
              />
            </div>
          );
        }
        const i = seg.index;
        const block = seg.block;
        const key = `${messageId}:${i}`;
        const isLast = i === lastIndex;
        return (
          <div
            key={key}
            className={`leo-assistant-block leo-assistant-block-${block.type}`}
            data-block-index={i}
            data-block-type={block.type}
          >
            {renderBlock({
              block,
              blockId: key,
              isLast,
              streaming,
              renderMarkdown: props.renderMarkdown,
              clipboard: props.clipboard,
              setIcon: props.setIcon,
              toolUseById,
              toolUseSlots: props.toolUseSlots,
            })}
          </div>
        );
      })}
    </div>
  );
}

function useRunStateSnapshot(slots: ToolUseBlockSlots | undefined): typeof EMPTY_RUN_STATE {
  const source = slots?.runState;
  const subscribe = (cb: () => void): (() => void) => {
    if (source === undefined) return () => undefined;
    return source.subscribe(cb);
  };
  const get = (): typeof EMPTY_RUN_STATE =>
    source === undefined ? EMPTY_RUN_STATE : (source.getSnapshot() as typeof EMPTY_RUN_STATE);
  return useSyncExternalStore(subscribe, get, get);
}

interface RenderCtx {
  readonly block: ContentBlock;
  readonly blockId: string;
  readonly isLast: boolean;
  readonly streaming: boolean;
  readonly renderMarkdown: MarkdownRenderFn;
  readonly clipboard: CodeBlockClipboard;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
  readonly toolUseById: Map<string, ToolUseBlock>;
  readonly toolUseSlots?: ToolUseBlockSlots;
}

function renderBlock(ctx: RenderCtx): JSX.Element {
  const { block } = ctx;
  if (block.type === 'text') {
    return (
      <TextBlockView
        block={block as TextBlock}
        blockId={ctx.blockId}
        showCursor={ctx.isLast && ctx.streaming}
        renderMarkdown={ctx.renderMarkdown}
        clipboard={ctx.clipboard}
        {...(ctx.setIcon !== undefined ? { setIcon: ctx.setIcon } : {})}
      />
    );
  }
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return (
      <ThinkingBlockView
        block={block as ThinkingBlock | RedactedThinkingBlock}
        streaming={ctx.isLast && ctx.streaming}
      />
    );
  }
  if (block.type === 'tool_use') {
    return (
      <ToolUseBlockView
        block={block as ToolUseBlock}
        {...(ctx.toolUseSlots !== undefined ? { slots: ctx.toolUseSlots } : {})}
      />
    );
  }
  if (block.type === 'tool_result') {
    const tr = block as ToolResultBlock;
    const associated = ctx.toolUseById.get(tr.tool_use_id);
    return (
      <ToolResultBlockView
        block={tr}
        {...(associated !== undefined ? { associatedToolUse: associated } : {})}
        {...(ctx.toolUseSlots?.runState !== undefined
          ? { runState: ctx.toolUseSlots.runState }
          : {})}
      />
    );
  }
  return (
    <div className="leo-assistant-block-unknown" data-debug="unknown-block-type">
      unknown block: {(block as { type: string }).type}
    </div>
  );
}

export const MemoAssistantBlocks = memo(AssistantBlocks);
