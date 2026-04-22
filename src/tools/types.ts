import type { Logger } from '@/platform/Logger';

export interface JsonSchema {
  readonly type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'null';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JsonSchema;
}

export type ToolResult<T = unknown> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export interface ToolCtx {
  readonly thread: string;
  readonly signal: AbortSignal;
  readonly logger?: Logger;
  readonly agentId?: string | null;
}

export type ToolSource = 'builtin' | 'user' | 'mcp';

export interface ToolValidate<TArgs> {
  (raw: unknown): ToolResult<TArgs>;
}

export interface ToolSpec<TArgs = unknown, TData = unknown> {
  readonly id: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly requiresConfirmation: boolean;
  readonly source: ToolSource;
  readonly validate: ToolValidate<TArgs>;
  invoke(args: TArgs, ctx: ToolCtx): Promise<ToolResult<TData>>;
}
