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

function ToolResultBlockViewImpl(props: ToolResultBlockViewProps): JSX.Element {
  const { block, associatedToolUse } = props;
  const isError = block.is_error === true;
  const rawText = toolResultContentToText(block.content);
  const contentText = formatForDisplay(rawText, isError);
  const [expanded, setExpanded] = useState<boolean>(false);
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
  const hasBody = status === 'success' || status === 'errored';
  const collapsible = hasBody && props.renderBody === undefined && !hasMcpUi;
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
        {collapsible ? (
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
        <div className="leo-tool-result-body-inner" aria-hidden={isCollapsed}>
          <pre className="leo-tool-result-body" data-slot="tool-result-body" data-status="errored">
            {contentText}
          </pre>
        </div>
      </div>
    );
  }
  if (props.renderBody !== undefined) {
    return props.renderBody(props.block, associated);
  }
  return (
    <div className="leo-tool-result-body-wrap">
      <div className="leo-tool-result-body-inner" aria-hidden={isCollapsed}>
        <pre className="leo-tool-result-body" data-slot="tool-result-body" data-status="success">
          {contentText}
        </pre>
      </div>
    </div>
  );
}

function formatForDisplay(raw: string, isError: boolean): string {
  if (raw.length === 0) return raw;
  if (raw[0] !== '{' && raw[0] !== '[') return raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return raw;
    const obj = parsed as { ok?: unknown; data?: unknown; error?: unknown };
    if (isError && typeof obj.error === 'string') return obj.error;
    if (obj.ok === false && typeof obj.error === 'string') return obj.error;
    if (obj.ok === true && obj.data !== undefined) {
      if (typeof obj.data === 'string') return obj.data;
      return JSON.stringify(obj.data, null, 2);
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

export const ToolResultBlockView = memo(ToolResultBlockViewImpl);
