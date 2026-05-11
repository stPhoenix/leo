import { memo, useState, type ReactNode } from 'react';
import {
  toolResultContentToText,
  type McpUiContent,
  type ToolResultBlock,
  type ToolResultContent,
  type ToolUseBlock,
} from '@/chat/types';
import { resolveStatus, useToolUseStatus, type RunStateSource } from './toolUseStatus';
import { useMcpUiContext } from '../mcpUiContext';
import { MCPUIBlockView } from './MCPUIBlockView';

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
  const contentText = toolResultContentToText(block.content);
  const long = contentText.length > (props.defaultCollapseAtChars ?? DEFAULT_COLLAPSE);
  const [expanded, setExpanded] = useState<boolean>(!long || isError);
  const fromStore = useToolUseStatus(props.runState, block.tool_use_id);
  const mcpUiCtx = useMcpUiContext();
  const mcpUiResources = collectMcpUi(block.content);

  if (associatedToolUse === undefined) {
    return (
      <section
        className="leo-tool-result leo-tool-result-orphan"
        data-slot="tool-result-orphan"
        data-status="orphan"
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
  let status: 'success' | 'errored' | 'rejected' | 'canceled';
  if (isError) status = 'errored';
  else if (derived === 'rejected') status = 'rejected';
  else if (derived === 'canceled') status = 'canceled';
  else status = 'success';

  const hasMcpUi = mcpUiResources.length > 0 && mcpUiCtx !== null;
  const collapsible = status === 'success' && long && props.renderBody === undefined && !hasMcpUi;
  const isCollapsed = collapsible && !expanded;
  return (
    <section
      className={`leo-tool-result leo-tool-result-${status}${isCollapsed ? ' is-collapsed' : ''}`}
      data-slot="tool-result"
      data-status={status}
      data-tool-use-id={block.tool_use_id}
      aria-label="tool result"
    >
      <header className="leo-tool-result-header" data-slot="tool-result-header">
        {renderHeader(status, block, contentText)}
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
      {renderBody(props, status, isCollapsed, associatedToolUse, contentText)}
      {hasMcpUi
        ? mcpUiResources.map((resource, idx) => (
            <MCPUIBlockView
              key={`${resource.uri}:${idx}`}
              resource={resource}
              theme={mcpUiCtx.theme}
              onAction={(action) => mcpUiCtx.dispatchAction(action, resource.serverId ?? 'unknown')}
              {...(mcpUiCtx.onError !== undefined ? { onError: mcpUiCtx.onError } : {})}
            />
          ))
        : null}
    </section>
  );
}

function collectMcpUi(content: ToolResultContent): readonly McpUiContent[] {
  if (typeof content === 'string') return [];
  const out: McpUiContent[] = [];
  for (const c of content) {
    if (c.type === 'mcp_ui') out.push(c);
  }
  return out;
}

function renderHeader(
  status: 'success' | 'errored' | 'rejected' | 'canceled',
  _block: ToolResultBlock,
  contentText: string,
): ReactNode {
  if (status === 'errored') return <span data-slot="tool-result-label">⚠ Tool error</span>;
  if (status === 'rejected') {
    const reason = contentText.length > 0 ? `· ${contentText}` : '';
    return <span data-slot="tool-result-label">Rejected by user {reason}</span>;
  }
  if (status === 'canceled') {
    return <span data-slot="tool-result-label">Canceled · ⎋</span>;
  }
  return <span data-slot="tool-result-label">result · {contentText.length} chars</span>;
}

function renderBody(
  props: ToolResultBlockViewProps,
  status: 'success' | 'errored' | 'rejected' | 'canceled',
  isCollapsed: boolean,
  associated: ToolUseBlock,
  contentText: string,
): ReactNode {
  if (status === 'rejected' || status === 'canceled') return null;
  if (status === 'errored') {
    return (
      <div className="leo-tool-result-body-wrap">
        <pre className="leo-tool-result-body" data-slot="tool-result-body" data-status="errored">
          {contentText}
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
        {contentText}
      </pre>
    </div>
  );
}

export const ToolResultBlockView = memo(ToolResultBlockViewImpl);
