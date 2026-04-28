import { memo, useState, type ReactNode } from 'react';
import type { ToolUseBlock } from '@/chat/types';
import {
  type RunStateSource,
  type ToolUseStatus,
  resolveStatus,
  useToolUseStatus,
  StatusGlyph,
} from './toolUseStatus';

export interface ToolUseBlockSlots {
  readonly runState?: RunStateSource;
  readonly renderArgs?: (block: ToolUseBlock) => ReactNode;
  readonly renderProgress?: (block: ToolUseBlock, status: ToolUseStatus) => ReactNode;
  readonly renderResult?: (block: ToolUseBlock, status: ToolUseStatus) => ReactNode;
}

export interface ToolUseBlockViewProps {
  readonly block: ToolUseBlock;
  readonly slots?: ToolUseBlockSlots;
  /**
   * Force initial collapsed state. Defaults to `true` once the tool reaches a
   * terminal status (success/errored/rejected/canceled) and `false` while
   * queued/running. Users can always toggle.
   */
  readonly defaultCollapsed?: boolean;
}

const TERMINAL_STATUSES = new Set<ToolUseStatus>(['success', 'errored', 'rejected', 'canceled']);

function defaultArgsLine(block: ToolUseBlock): string {
  if (block.raw !== undefined) return '…';
  try {
    const text = JSON.stringify(block.input ?? {});
    if (text.length > 120) return `${text.slice(0, 117)}…`;
    return text;
  } catch {
    return '…';
  }
}

function ToolUseBlockViewImpl(props: ToolUseBlockViewProps): JSX.Element {
  const { block, slots } = props;
  const runStateStatus = useToolUseStatus(slots?.runState, block.id);
  const status: ToolUseStatus = resolveStatus(runStateStatus, block);
  const argsContent = slots?.renderArgs?.(block) ?? defaultArgsLine(block);

  const autoCollapsed = TERMINAL_STATUSES.has(status);
  const initialCollapsed = props.defaultCollapsed ?? autoCollapsed;
  const [userOverride, setUserOverride] = useState<boolean | null>(null);
  const collapsed = userOverride ?? initialCollapsed;

  const hasBody = slots?.renderProgress !== undefined || slots?.renderResult !== undefined;

  return (
    <section
      className={`leo-tool-use leo-tool-use-${status}${collapsed ? ' is-collapsed' : ' is-expanded'}`}
      data-slot="tool-use"
      data-tool-id={block.id}
      data-tool-name={block.name}
      data-tool-status={status}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <header className="leo-tool-use-header" data-slot="tool-use-header">
        <StatusGlyph status={status} />
        <strong className="leo-tool-use-name" data-slot="tool-use-name">
          {block.name}
        </strong>
        <span className="leo-tool-use-args" data-slot="tool-use-args">
          ({argsContent})
        </span>
        {hasBody ? (
          <button
            type="button"
            className="leo-tool-use-toggle"
            data-slot="tool-use-toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'expand tool details' : 'collapse tool details'}
            onClick={() => setUserOverride((prev) => !(prev ?? initialCollapsed))}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : null}
      </header>
      {hasBody ? (
        <div className="leo-tool-use-body-wrap">
          <div className="leo-tool-use-body" aria-hidden={collapsed}>
            {slots?.renderProgress !== undefined ? (
              <div className="leo-tool-use-progress" data-slot="tool-use-progress">
                {slots.renderProgress(block, status)}
              </div>
            ) : null}
            {slots?.renderResult !== undefined ? (
              <div className="leo-tool-use-result" data-slot="tool-use-result">
                {slots.renderResult(block, status)}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export const ToolUseBlockView = memo(ToolUseBlockViewImpl);
