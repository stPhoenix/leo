import { memo, useState } from 'react';
import type { ToolUseBlock } from '@/chat/types';
import { ToolUseBlockView, type ToolUseBlockSlots } from './ToolUseBlockView';

export interface GroupedToolUsesProps {
  readonly toolName: string;
  readonly blocks: readonly ToolUseBlock[];
  readonly slots?: ToolUseBlockSlots;
  readonly defaultCollapsed?: boolean;
}

function GroupedToolUsesImpl(props: GroupedToolUsesProps): JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(!(props.defaultCollapsed ?? true));
  const paths = previewInputs(props.blocks);
  return (
    <section
      className={`leo-grouped-tool-uses${expanded ? ' is-expanded' : ' is-collapsed'}`}
      data-slot="grouped-tool-uses"
      data-tool-name={props.toolName}
      data-count={props.blocks.length}
    >
      <button
        type="button"
        className="leo-grouped-summary"
        data-slot="grouped-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span data-slot="grouped-glyph">○</span>{' '}
        <strong>
          {summaryLabel(props.toolName, props.blocks.length)}
          {paths.length > 0 ? `: ${paths.join(', ')}` : ''}
        </strong>{' '}
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      <div className="leo-grouped-tool-uses-body-wrap">
        <ul className="leo-grouped-list" data-slot="grouped-list" aria-hidden={!expanded}>
          {props.blocks.map((b) => (
            <li key={b.id} className="leo-grouped-item">
              <ToolUseBlockView
                block={b}
                {...(props.slots !== undefined ? { slots: props.slots } : {})}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function summaryLabel(toolName: string, count: number): string {
  const verb = toolName === 'readNote' || toolName === 'Read' ? 'Read' : toolName;
  return `${verb} ${count} ${count === 1 ? 'item' : 'items'}`;
}

function previewInputs(blocks: readonly ToolUseBlock[]): string[] {
  const paths: string[] = [];
  for (const b of blocks) {
    if (typeof b.input === 'object' && b.input !== null) {
      const obj = b.input as { path?: string; query?: string };
      if (typeof obj.path === 'string') paths.push(obj.path);
      else if (typeof obj.query === 'string') paths.push(obj.query);
    }
    if (paths.length >= 3) break;
  }
  if (blocks.length > paths.length && paths.length > 0) {
    paths.push(`+${blocks.length - paths.length}`);
  }
  return paths;
}

export const GroupedToolUses = memo(GroupedToolUsesImpl);
