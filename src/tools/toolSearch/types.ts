import type { ToolSpec } from '@/tools/types';
import type { ToolReferenceBlock } from '@/chat/types';

export type ToolSearchMode = 'standard' | 'tst' | 'tst-auto';

export interface DeferralRulesContext {
  readonly toolSearchToolId: string;
  readonly alwaysLoadIds?: ReadonlySet<string>;
}

export interface DeferralPartition {
  readonly included: readonly ToolSpec[];
  readonly deferLoading: ReadonlySet<string>;
}

export interface SearchHit {
  readonly name: string;
  readonly score: number;
}

export interface SearchOptions {
  readonly maxResults?: number;
  readonly descriptionOf?: (name: string) => string;
}

export interface SearchSnapshot {
  readonly deferred: readonly ToolSpec[];
  readonly all: readonly ToolSpec[];
  readonly pendingMcpServers?: readonly string[];
  readonly nativeDeferral: boolean;
}

export interface ToolSearchInvocationResult {
  readonly matches: readonly string[];
  readonly query: string;
  readonly total_deferred_tools: number;
  readonly pending_mcp_servers?: readonly string[];
  readonly schemaPayload?: string;
}

export type ToolReferenceContent = readonly ToolReferenceBlock[];
