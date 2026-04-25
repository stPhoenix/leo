import type { ToolCallRequest } from '@/providers/types';
import type { ToolResult } from '@/tools/types';
import type { ToolConfirmationDecision, ToolConfirmationStreamRequest } from './types';

/**
 * Canonical UI-facing stream event union (architecture.md §4). `AgentRunner`
 * is the sole emitter; provider-level events are transformed at the boundary.
 */
export type StreamEvent =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: ToolCallRequest }
  | {
      readonly type: 'tool_confirmation';
      readonly request: ToolConfirmationStreamRequest;
      readonly resolve: (decision: ToolConfirmationDecision) => void;
    }
  | { readonly type: 'tool_result'; readonly id: string; readonly result: ToolResult }
  | { readonly type: 'usage'; readonly input: number; readonly output: number }
  | { readonly type: 'done'; readonly cancelled?: boolean }
  | { readonly type: 'error'; readonly error: Error };
