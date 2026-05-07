import type { z } from 'zod';
import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WorkspaceNavigator } from '@/editor/workspaceNavigator';
import type { CanvasNavigator } from '@/editor/canvasNavigator';
import type { ReadFileStateStore } from './builtin/readFileState';

/**
 * Edit-capable editor facade supplied to tools via ToolCtx. `ctx.editor` is
 * the narrowed interface tools need for active-note edits; the fuller
 * `EditorBridge` class tracks focused context and is not piped through tools.
 */
export interface EditNoteBridge {
  isActiveNote(path: string): boolean;
  applyActiveEdit(input: {
    path: string;
    lineStart: number;
    lineEnd: number;
    newContent: string;
    signal: AbortSignal;
  }): Promise<{ ok: true; bytesWritten: number; undo: () => void } | { ok: false; error: string }>;
}

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

export interface ToolProgressEvent {
  readonly kind: 'bash' | 'web_search' | 'task_output' | 'mcp' | 'agent' | 'skill';
  readonly toolUseId: string;
  readonly [key: string]: unknown;
}

export interface ToolCtx {
  readonly thread: string;
  readonly signal: AbortSignal;
  readonly vault: VaultAdapter;
  readonly editor: EditNoteBridge;
  readonly navigator?: WorkspaceNavigator;
  readonly canvasNavigator?: CanvasNavigator;
  readonly logger?: Logger;
  readonly agentId?: string | null;
  readonly progress?: (event: ToolProgressEvent) => void;
  readonly readState?: ReadFileStateStore;
  readonly excludeMatcher?: (path: string) => boolean;
}

export interface ToolSpecBase {
  readonly isReadOnly?: boolean;
}

export type ToolSource = 'builtin' | 'user' | 'mcp';

export interface ToolValidate<TArgs> {
  (raw: unknown): ToolResult<TArgs>;
}

export interface ToolSpec<TArgs = unknown, TData = unknown> extends ToolSpecBase {
  readonly id: string;
  readonly description: string;
  readonly schema: z.ZodType<TArgs>;
  readonly parameters: JsonSchema;
  readonly requiresConfirmation: boolean;
  readonly source: ToolSource;
  readonly validate: ToolValidate<TArgs>;
  readonly isMcp?: boolean;
  readonly shouldDefer?: boolean;
  readonly alwaysLoad?: boolean;
  readonly searchHint?: string;
  invoke(args: TArgs, ctx: ToolCtx): Promise<ToolResult<TData>>;
}
