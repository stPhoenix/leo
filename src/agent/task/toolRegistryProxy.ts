import type { OpenAITool } from '@/providers/types';
import { ToolRegistry, type ToolListOptions } from '@/tools/toolRegistry';
import type { ToolCtx, ToolResult, ToolSpec } from '@/tools/types';

/**
 * Tool ids the subagent (`task` tool) MUST NOT see or be able to invoke.
 *
 * - Recursive delegate tools (`task`, `delegate_external`, `delegate_canvas_*`)
 *   are stripped to prevent unbounded nesting and reentrant orchestrators.
 * - Plan-mode tools (`EnterPlanMode`, `ExitPlanMode`) are stripped — the
 *   subagent is opaque to the user, plan-mode approval has no surface here.
 * - `AskUserQuestion` is stripped — subagents already refuse it at the tool
 *   level (see `askUserQuestion.ts:65`), but stripping from listFor +
 *   toOpenAITools means the LLM does not even see the option.
 *
 * Filter is by id string at every entry point (lookup / listFor /
 * toOpenAITools / invoke), so an MCP server that republishes any of these
 * names cannot punch through.
 */
export const TASK_FORBIDDEN_TOOL_IDS: ReadonlySet<string> = new Set<string>([
  'task',
  'delegate_external',
  'delegate_canvas_create',
  'delegate_canvas_content_edit',
  'delegate_canvas_layout_edit',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
]);

export class SubagentToolRegistryProxy extends ToolRegistry {
  private readonly parent: ToolRegistry;
  private readonly forbidden: ReadonlySet<string>;

  constructor(parent: ToolRegistry, forbidden: ReadonlySet<string> = TASK_FORBIDDEN_TOOL_IDS) {
    super();
    this.parent = parent;
    this.forbidden = forbidden;
  }

  override register(_spec: ToolSpec<unknown, unknown>): void {
    throw new Error('SubagentToolRegistryProxy: register() not supported on subagent registry');
  }

  override unregister(_id: string): boolean {
    throw new Error('SubagentToolRegistryProxy: unregister() not supported on subagent registry');
  }

  override lookup(id: string): ToolSpec<unknown, unknown> | undefined {
    if (this.forbidden.has(id)) return undefined;
    return this.parent.lookup(id);
  }

  override listFor(
    thread: string,
    opts: ToolListOptions = {},
  ): readonly ToolSpec<unknown, unknown>[] {
    return this.parent.listFor(thread, opts).filter((spec) => !this.forbidden.has(spec.id));
  }

  override toOpenAITools(thread: string, opts: ToolListOptions = {}): readonly OpenAITool[] {
    return this.parent
      .toOpenAITools(thread, opts)
      .filter((tool) => !this.forbidden.has(tool.function.name));
  }

  override async invoke(id: string, argsJson: string, ctx: ToolCtx): Promise<ToolResult<unknown>> {
    if (this.forbidden.has(id)) {
      return { ok: false, error: `tool '${id}' is forbidden in subagent context` };
    }
    return this.parent.invoke(id, argsJson, ctx);
  }
}
