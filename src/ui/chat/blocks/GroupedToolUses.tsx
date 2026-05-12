import { memo, useState } from 'react';
import type { GroupedToolPair } from '@/chat/groupReadOnly';
import { ToolUseBlockView, type ToolUseBlockSlots } from './ToolUseBlockView';
import { ToolResultBlockView } from './ToolResultBlockView';

export interface GroupedToolUsesProps {
  readonly toolName: string;
  readonly pairs: readonly GroupedToolPair[];
  readonly slots?: ToolUseBlockSlots;
  readonly defaultCollapsed?: boolean;
}

function GroupedToolUsesImpl(props: GroupedToolUsesProps): JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(!(props.defaultCollapsed ?? true));
  const paths = previewInputs(props.pairs);
  const runState = props.slots?.runState;
  return (
    <section
      className={`leo-grouped-tool-uses${expanded ? ' is-expanded' : ' is-collapsed'}`}
      data-slot="grouped-tool-uses"
      data-tool-name={props.toolName}
      data-count={props.pairs.length}
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
          {summaryLabel(props.toolName, props.pairs.length)}
          {paths.length > 0 ? `: ${paths.join(', ')}` : ''}
        </strong>{' '}
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      <div className="leo-grouped-tool-uses-body-wrap">
        <ul className="leo-grouped-list" data-slot="grouped-list" aria-hidden={!expanded}>
          {props.pairs.map((pair) => (
            <li key={pair.toolUse.id} className="leo-grouped-item">
              <ToolUseBlockView
                block={pair.toolUse}
                {...(props.slots !== undefined ? { slots: props.slots } : {})}
              />
              {pair.result !== undefined ? (
                <ToolResultBlockView
                  block={pair.result}
                  associatedToolUse={pair.toolUse}
                  {...(runState !== undefined ? { runState } : {})}
                />
              ) : null}
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

function previewInputs(pairs: readonly GroupedToolPair[]): string[] {
  const paths: string[] = [];
  for (const pair of pairs) {
    const input = pair.toolUse.input;
    if (typeof input === 'object' && input !== null) {
      const obj = input as { path?: string; query?: string };
      if (typeof obj.path === 'string') paths.push(obj.path);
      else if (typeof obj.query === 'string') paths.push(obj.query);
    }
    if (paths.length >= 3) break;
  }
  if (pairs.length > paths.length && paths.length > 0) {
    paths.push(`+${pairs.length - paths.length}`);
  }
  return paths;
}

export const GroupedToolUses = memo(GroupedToolUsesImpl);
