import type { Logger } from '@/platform/Logger';
import type { OpenAITool } from '@/providers/types';
import type { ToolCtx, ToolResult, ToolSpec } from './types';

export type PlanModeView = 'normal' | 'plan';

export interface ToolListOptions {
  readonly allowedTools?: ReadonlySet<string>;
  readonly planMode?: PlanModeView;
}

export interface ToolRegistryOptions {
  readonly logger?: Logger;
  readonly isToolAllowedInPlan?: (toolId: string, thread: string) => boolean;
  readonly recordToolBlocked?: (thread: string, toolId: string) => void;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec<unknown, unknown>>();
  private readonly logger: Logger | undefined;
  private readonly isToolAllowedInPlan: ((toolId: string, thread: string) => boolean) | undefined;
  private readonly recordToolBlocked: ((thread: string, toolId: string) => void) | undefined;

  constructor(opts: ToolRegistryOptions = {}) {
    this.logger = opts.logger;
    this.isToolAllowedInPlan = opts.isToolAllowedInPlan;
    this.recordToolBlocked = opts.recordToolBlocked;
  }

  register(spec: ToolSpec<unknown, unknown>): void {
    if (this.tools.has(spec.id)) {
      throw new Error(`ToolRegistry: duplicate tool id ${spec.id}`);
    }
    this.tools.set(spec.id, spec);
    this.logger?.info('tool.register', {
      toolId: spec.id,
      source: spec.source,
      requiresConfirmation: spec.requiresConfirmation,
    });
  }

  lookup(id: string): ToolSpec<unknown, unknown> | undefined {
    return this.tools.get(id);
  }

  unregister(id: string): boolean {
    const had = this.tools.delete(id);
    if (had) this.logger?.info('tool.unregister', { toolId: id });
    return had;
  }

  listFor(thread: string, opts: ToolListOptions = {}): readonly ToolSpec<unknown, unknown>[] {
    const all = [...this.tools.values()];
    return all.filter((spec) => this.isVisible(spec.id, thread, opts));
  }

  toOpenAITools(thread: string, opts: ToolListOptions = {}): readonly OpenAITool[] {
    return this.listFor(thread, opts).map((spec) => ({
      type: 'function' as const,
      function: {
        name: spec.id,
        description: spec.description,
        parameters: spec.parameters,
      },
    }));
  }

  async invoke(id: string, argsJson: string, ctx: ToolCtx): Promise<ToolResult<unknown>> {
    const spec = this.tools.get(id);
    if (spec === undefined) {
      return { ok: false, error: `unknown tool: ${id}` };
    }
    if (this.isToolAllowedInPlan !== undefined && !this.isToolAllowedInPlan(id, ctx.thread)) {
      this.recordToolBlocked?.(ctx.thread, id);
      this.logger?.warn('tool.invoke.error', {
        toolId: id,
        thread: ctx.thread,
        error: 'blocked by plan mode',
        stage: 'plan-mode',
      });
      return { ok: false, error: `tool blocked by plan mode: ${id}` };
    }
    let parsedArgs: unknown;
    try {
      parsedArgs = argsJson.length > 0 ? JSON.parse(argsJson) : {};
    } catch {
      return { ok: false, error: `invalid JSON args for ${id}` };
    }
    const validated = spec.validate(parsedArgs);
    if (!validated.ok) {
      this.logger?.warn('tool.invoke.error', {
        toolId: id,
        thread: ctx.thread,
        error: validated.error,
        stage: 'validate',
      });
      return validated;
    }
    const start = now();
    this.logger?.info('tool.invoke.start', { toolId: id, thread: ctx.thread });
    try {
      const result = await spec.invoke(validated.data, ctx);
      const durationMs = Math.round(now() - start);
      if (result.ok) {
        this.logger?.info('tool.invoke.ok', { toolId: id, thread: ctx.thread, durationMs });
      } else {
        this.logger?.warn('tool.invoke.error', {
          toolId: id,
          thread: ctx.thread,
          durationMs,
          error: result.error,
          stage: 'invoke',
        });
      }
      return result;
    } catch (err) {
      const durationMs = Math.round(now() - start);
      const error = err instanceof Error ? err.message : String(err);
      this.logger?.error('tool.invoke.error', {
        toolId: id,
        thread: ctx.thread,
        durationMs,
        error,
        stage: 'exception',
      });
      return { ok: false, error };
    }
  }

  private isVisible(toolId: string, thread: string, opts: ToolListOptions): boolean {
    if (opts.planMode === 'plan' && this.isToolAllowedInPlan !== undefined) {
      if (!this.isToolAllowedInPlan(toolId, thread)) return false;
    }
    if (opts.allowedTools !== undefined && !opts.allowedTools.has(toolId)) return false;
    return true;
  }
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
