import { memo, useState, type ReactNode } from 'react';
import type { ToolResultBlock, ToolUseBlock } from '@/chat/types';
import { resolveStatus, useToolUseStatus, type RunStateSource } from './toolUseStatus';

export interface ToolResultBlockViewProps {
  readonly block: ToolResultBlock;
  readonly associatedToolUse?: ToolUseBlock;
  readonly defaultCollapseAtChars?: number;
  readonly runState?: RunStateSource;
  readonly renderBody?: (block: ToolResultBlock, associated: ToolUseBlock) => ReactNode;
}

const DEFAULT_COLLAPSE = 2000;

function ToolResultBlockViewImpl(props: ToolResultBlockViewProps): JSX.Element {
  const { block, associatedToolUse } = props;
  const isError = block.is_error === true;
  const long = block.content.length > (props.defaultCollapseAtChars ?? DEFAULT_COLLAPSE);
  const [expanded, setExpanded] = useState<boolean>(!long || isError);
  const fromStore = useToolUseStatus(props.runState, block.tool_use_id);

  if (associatedToolUse === undefined) {
    return (
      <section
        className="leo-tool-result leo-tool-result-orphan"
        data-slot="tool-result-orphan"
        data-status="orphan"
        role="group"
        aria-label="tool result"
      >
        <header className="leo-tool-result-header">
          ⚠ Orphan tool_result · {block.tool_use_id}
        </header>
      </section>
    );
  }

  const derived = resolveStatus(fromStore, associatedToolUse);
  // tool_result block + run-state combine: explicit is_error wins over store success state.
  const status: 'success' | 'errored' | 'rejected' | 'canceled' = isError
    ? 'errored'
    : derived === 'rejected'
      ? 'rejected'
      : derived === 'canceled'
        ? 'canceled'
        : 'success';

  const collapsible = status === 'success' && long && props.renderBody === undefined;
  const isCollapsed = collapsible && !expanded;
  return (
    <section
      className={`leo-tool-result leo-tool-result-${status}${isCollapsed ? ' is-collapsed' : ''}`}
      data-slot="tool-result"
      data-status={status}
      data-tool-use-id={block.tool_use_id}
      role="group"
      aria-label="tool result"
    >
      <header className="leo-tool-result-header" data-slot="tool-result-header">
        {renderHeader(status, block)}
        {status === 'success' && long ? (
          <button
            type="button"
            className="leo-tool-result-toggle"
            data-slot="tool-result-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▾ show less' : '▸ show more'}
          </button>
        ) : null}
      </header>
      {renderBody(props, status, isCollapsed, associatedToolUse)}
    </section>
  );
}

function renderHeader(
  status: 'success' | 'errored' | 'rejected' | 'canceled',
  block: ToolResultBlock,
): ReactNode {
  if (status === 'errored') return <span data-slot="tool-result-label">⚠ Tool error</span>;
  if (status === 'rejected') {
    const reason = block.content.length > 0 ? `· ${block.content}` : '';
    return <span data-slot="tool-result-label">Rejected by user {reason}</span>;
  }
  if (status === 'canceled') {
    return <span data-slot="tool-result-label">Canceled · ⎋</span>;
  }
  return <span data-slot="tool-result-label">result · {block.content.length} chars</span>;
}

function renderBody(
  props: ToolResultBlockViewProps,
  status: 'success' | 'errored' | 'rejected' | 'canceled',
  isCollapsed: boolean,
  associated: ToolUseBlock,
): ReactNode {
  if (status === 'rejected' || status === 'canceled') return null;
  if (status === 'errored') {
    return (
      <div className="leo-tool-result-body-wrap">
        <pre className="leo-tool-result-body" data-slot="tool-result-body" data-status="errored">
          {props.block.content}
        </pre>
      </div>
    );
  }
  if (props.renderBody !== undefined) {
    return props.renderBody(props.block, associated);
  }
  return (
    <div className="leo-tool-result-body-wrap">
      <pre
        className="leo-tool-result-body"
        data-slot="tool-result-body"
        data-status="success"
        aria-hidden={isCollapsed}
      >
        {props.block.content}
      </pre>
    </div>
  );
}

export const ToolResultBlockView = memo(ToolResultBlockViewImpl);
