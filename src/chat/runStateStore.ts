import type { ContentBlock, ToolUseBlock } from './types';
import type { ToolResult } from '@/tools/types';

export type ToolUseRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'errored'
  | 'rejected'
  | 'canceled';

export type ProgressEvent =
  | {
      readonly kind: 'bash';
      readonly toolUseId: string;
      readonly stdout?: string;
      readonly stderr?: string;
      readonly exitCode?: number;
    }
  | {
      readonly kind: 'web_search';
      readonly toolUseId: string;
      readonly query: string;
      readonly resultsSoFar: number;
    }
  | {
      readonly kind: 'task_output';
      readonly toolUseId: string;
      readonly status: string;
      readonly taskId: string;
    }
  | {
      readonly kind: 'mcp';
      readonly toolUseId: string;
      readonly serverName: string;
      readonly methodCall: string;
    }
  | {
      readonly kind: 'agent';
      readonly toolUseId: string;
      readonly agentId: string;
      readonly agentType: string;
      readonly name?: string;
      readonly toolUseCount: number;
      readonly tokens?: number;
      readonly lastToolInfo?: string;
      readonly isResolved?: boolean;
      readonly isError?: boolean;
    }
  | {
      readonly kind: 'skill';
      readonly toolUseId: string;
      readonly skillName: string;
      readonly status: string;
    };

export interface PermissionRequest {
  readonly toolUseId: string;
  readonly toolId: string;
  readonly thread: string;
  readonly argsJson: string;
  readonly category: 'read' | 'write';
}

export interface RunStateSnapshot {
  readonly inProgressToolUseIds: ReadonlySet<string>;
  readonly resolvedToolUseIds: ReadonlySet<string>;
  readonly erroredToolUseIds: ReadonlySet<string>;
  readonly rejectedToolUseIds: ReadonlySet<string>;
  readonly canceledToolUseIds: ReadonlySet<string>;
  readonly progressByToolUseId: ReadonlyMap<string, readonly ProgressEvent[]>;
  readonly permissionRequests: ReadonlyMap<string, PermissionRequest>;
  readonly toolResults: ReadonlyMap<string, ToolResult>;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_PROGRESS: ReadonlyMap<string, readonly ProgressEvent[]> = new Map();
const EMPTY_PERMISSIONS: ReadonlyMap<string, PermissionRequest> = new Map();
const EMPTY_RESULTS: ReadonlyMap<string, ToolResult> = new Map();

export const EMPTY_RUN_STATE: RunStateSnapshot = Object.freeze({
  inProgressToolUseIds: EMPTY_SET,
  resolvedToolUseIds: EMPTY_SET,
  erroredToolUseIds: EMPTY_SET,
  rejectedToolUseIds: EMPTY_SET,
  canceledToolUseIds: EMPTY_SET,
  progressByToolUseId: EMPTY_PROGRESS,
  permissionRequests: EMPTY_PERMISSIONS,
  toolResults: EMPTY_RESULTS,
});

export function statusOf(state: RunStateSnapshot, id: string): ToolUseRunStatus {
  if (state.rejectedToolUseIds.has(id)) return 'rejected';
  if (state.canceledToolUseIds.has(id)) return 'canceled';
  if (state.erroredToolUseIds.has(id)) return 'errored';
  if (state.resolvedToolUseIds.has(id)) return 'success';
  if (state.inProgressToolUseIds.has(id)) return 'running';
  return 'queued';
}

export function statusForBlock(state: RunStateSnapshot, block: ToolUseBlock): ToolUseRunStatus {
  if (block.decision === 'deny') return 'rejected';
  return statusOf(state, block.id);
}

export class RunStateStore {
  private state: RunStateSnapshot = EMPTY_RUN_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly perIdListeners = new Map<string, Set<() => void>>();

  getSnapshot = (): RunStateSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeToolUse = (id: string, listener: () => void): (() => void) => {
    let bucket = this.perIdListeners.get(id);
    if (bucket === undefined) {
      bucket = new Set();
      this.perIdListeners.set(id, bucket);
    }
    bucket.add(listener);
    return () => {
      const b = this.perIdListeners.get(id);
      if (b === undefined) return;
      b.delete(listener);
      if (b.size === 0) this.perIdListeners.delete(id);
    };
  };

  markRunning(id: string): void {
    this.mutate(id, (s) => withSetAdd(s, 'inProgressToolUseIds', id));
  }

  markResolved(id: string, isError: boolean, result?: ToolResult): void {
    this.mutate(id, (s) => {
      let next = withSetRemove(s, 'inProgressToolUseIds', id);
      next = withSetAdd(next, 'resolvedToolUseIds', id);
      if (isError) next = withSetAdd(next, 'erroredToolUseIds', id);
      if (result !== undefined) {
        const map = new Map(next.toolResults);
        map.set(id, result);
        next = { ...next, toolResults: map };
      }
      return next;
    });
  }

  recordToolResult(id: string, result: ToolResult): void {
    this.mutate(id, (s) => {
      const map = new Map(s.toolResults);
      map.set(id, result);
      return { ...s, toolResults: map };
    });
  }

  markRejected(id: string): void {
    this.mutate(id, (s) => {
      let next = withSetRemove(s, 'inProgressToolUseIds', id);
      next = withSetAdd(next, 'rejectedToolUseIds', id);
      return next;
    });
  }

  markCanceled(id: string): void {
    this.mutate(id, (s) => {
      let next = withSetRemove(s, 'inProgressToolUseIds', id);
      next = withSetAdd(next, 'canceledToolUseIds', id);
      return next;
    });
  }

  appendProgress(id: string, ev: ProgressEvent): void {
    this.mutate(id, (s) => {
      const map = new Map(s.progressByToolUseId);
      const prev = map.get(id) ?? [];
      map.set(id, [...prev, ev]);
      return { ...s, progressByToolUseId: map };
    });
  }

  clearProgress(id: string): void {
    this.mutate(id, (s) => {
      if (!s.progressByToolUseId.has(id)) return s;
      const map = new Map(s.progressByToolUseId);
      map.delete(id);
      return { ...s, progressByToolUseId: map };
    });
  }

  recordPermissionRequest(id: string, req: PermissionRequest): void {
    this.mutate(id, (s) => {
      const map = new Map(s.permissionRequests);
      map.set(id, req);
      return { ...s, permissionRequests: map };
    });
  }

  clearPermissionRequest(id: string): void {
    this.mutate(id, (s) => {
      if (!s.permissionRequests.has(id)) return s;
      const map = new Map(s.permissionRequests);
      map.delete(id);
      return { ...s, permissionRequests: map };
    });
  }

  cancelAllInProgress(): readonly string[] {
    const ids = Array.from(this.state.inProgressToolUseIds);
    for (const id of ids) this.markCanceled(id);
    return ids;
  }

  reset(): void {
    if (this.state === EMPTY_RUN_STATE) return;
    const previousIds = collectAllIds(this.state);
    this.state = EMPTY_RUN_STATE;
    this.notifyAll();
    for (const id of previousIds) this.notifyId(id);
  }

  blocksToCanceledMarker(blocks: readonly ContentBlock[]): readonly ContentBlock[] {
    const haveResult = new Set<string>();
    for (const b of blocks) {
      if (b.type === 'tool_result') haveResult.add(b.tool_use_id);
    }
    const out: ContentBlock[] = blocks.slice();
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue;
      if (haveResult.has(b.id)) continue;
      out.push({
        type: 'tool_result',
        tool_use_id: b.id,
        content: '(canceled)',
        is_error: true,
      });
      this.markCanceled(b.id);
    }
    return out;
  }

  private mutate(id: string, fn: (s: RunStateSnapshot) => RunStateSnapshot): void {
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    this.notifyAll();
    this.notifyId(id);
  }

  private notifyAll(): void {
    for (const l of this.listeners) l();
  }

  private notifyId(id: string): void {
    const bucket = this.perIdListeners.get(id);
    if (bucket === undefined) return;
    for (const l of bucket) l();
  }
}

type SetField =
  | 'inProgressToolUseIds'
  | 'resolvedToolUseIds'
  | 'erroredToolUseIds'
  | 'rejectedToolUseIds'
  | 'canceledToolUseIds';

function withSetAdd(s: RunStateSnapshot, field: SetField, id: string): RunStateSnapshot {
  const set = s[field];
  if (set.has(id)) return s;
  const next = new Set(set);
  next.add(id);
  return { ...s, [field]: next };
}

function withSetRemove(s: RunStateSnapshot, field: SetField, id: string): RunStateSnapshot {
  const set = s[field];
  if (!set.has(id)) return s;
  const next = new Set(set);
  next.delete(id);
  return { ...s, [field]: next };
}

function collectAllIds(s: RunStateSnapshot): readonly string[] {
  const ids = new Set<string>();
  for (const id of s.inProgressToolUseIds) ids.add(id);
  for (const id of s.resolvedToolUseIds) ids.add(id);
  for (const id of s.erroredToolUseIds) ids.add(id);
  for (const id of s.rejectedToolUseIds) ids.add(id);
  for (const id of s.canceledToolUseIds) ids.add(id);
  for (const id of s.progressByToolUseId.keys()) ids.add(id);
  for (const id of s.permissionRequests.keys()) ids.add(id);
  for (const id of s.toolResults.keys()) ids.add(id);
  return Array.from(ids);
}
