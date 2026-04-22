import type { Logger } from '@/platform/Logger';
import type { OpenAITool } from '@/providers/types';
import type { ToolCtx, ToolResult, ToolSpec } from './types';

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec<unknown, unknown>>();
  private readonly logger: Logger | undefined;

  constructor(opts: { readonly logger?: Logger } = {}) {
    this.logger = opts.logger;
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

  listFor(_thread: string): readonly ToolSpec<unknown, unknown>[] {
    return [...this.tools.values()];
  }

  toOpenAITools(thread: string): readonly OpenAITool[] {
    return this.listFor(thread).map((spec) => ({
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
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
