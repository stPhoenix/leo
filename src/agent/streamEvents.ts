import type { ToolCallRequest } from '@/providers/types';
import type { ToolResult } from '@/tools/types';
import type { ToolConfirmationDecision, ToolConfirmationStreamRequest } from './types';
import type {
  TextBlock,
  ThinkingBlock,
  RedactedThinkingBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '@/chat/types';
import type { ProgressEvent } from '@/chat/runStateStore';

export type ContentBlockStart =
  | { readonly type: 'text'; readonly text?: string }
  | { readonly type: 'thinking'; readonly thinking?: string; readonly signature?: string }
  | { readonly type: 'redacted_thinking'; readonly data: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly is_error?: boolean };

export type ContentBlockDelta =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'thinking_delta'; readonly thinking: string }
  | { readonly type: 'signature_delta'; readonly signature: string }
  | { readonly type: 'input_json_delta'; readonly partial_json: string }
  | { readonly type: 'tool_result_delta'; readonly text: string };

export type AssistantStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'cancelled';

/**
 * Canonical UI-facing stream event union (architecture.md §4). `AgentRunner`
 * is the sole emitter; provider-level events are transformed at the boundary.
 *
 * Live-status (§3 of livestatus.md) extends this with content-block framing:
 * `block_start`/`block_delta`/`block_stop`/`message_delta`/`progress`. Existing
 * `token`/`tool_call`/`tool_result` variants stay valid and are normalised by
 * the aggregator into the same typed-block representation.
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
  | {
      readonly type: 'usage';
      readonly input: number;
      readonly output: number;
      readonly reasoning?: number;
      readonly cacheCreation?: number;
      readonly cacheRead?: number;
    }
  | { readonly type: 'done'; readonly cancelled?: boolean }
  | { readonly type: 'error'; readonly error: Error }
  | {
      readonly type: 'block_start';
      readonly index: number;
      readonly block: ContentBlockStart;
    }
  | {
      readonly type: 'block_delta';
      readonly index: number;
      readonly delta: ContentBlockDelta;
    }
  | { readonly type: 'block_stop'; readonly index: number }
  | {
      readonly type: 'message_delta';
      readonly stopReason?: AssistantStopReason;
      readonly usage?: {
        readonly input?: number;
        readonly output?: number;
        readonly reasoning?: number;
        readonly cacheCreation?: number;
        readonly cacheRead?: number;
      };
    }
  | { readonly type: 'progress'; readonly event: ProgressEvent };

export type AggregatedContentBlock =
  | TextBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;
