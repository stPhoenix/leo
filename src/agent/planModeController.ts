import type { Logger } from '@/platform/Logger';
import type { TodoStore } from './todoStore';
import type { ThreadId } from './types';

export type PlanMode = 'normal' | 'plan';

export type PendingReminderKind = 'plan-enter' | 'plan-exit';

export interface PendingReminder {
  readonly kind: PendingReminderKind;
  readonly body: string;
}

export type StaleTodoSuppressReason = 'empty' | 'rate-limit' | 'todowrite-called';

export const PLAN_ENTER_REMINDER =
  '<system-reminder>\nPlan mode is now active. Only read-only tools and ExitPlanMode may be used. Present the final plan via ExitPlanMode when ready.\n</system-reminder>';

export const PLAN_EXIT_REMINDER =
  '<system-reminder>\nPlan mode is now inactive. Write-capable tools are available again.\n</system-reminder>';

export const STALE_TODO_REMINDER =
  '<system-reminder>\nYou have pending todos from an earlier plan. Update them via TodoWrite if your current work affects them.\n</system-reminder>';

export const DEFAULT_PLAN_MODE_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'EnterPlanMode',
  'ExitPlanMode',
  'read_note',
  'search_vault',
]);

export const DEFAULT_STALE_TODO_THRESHOLD = 10;

export class PlanModeForbiddenInSubagent extends Error {
  override readonly name = 'PlanModeForbiddenInSubagent';
}

export class PlanModeBlocked extends Error {
  override readonly name = 'PlanModeBlocked';
  constructor(public readonly toolId: string) {
    super(`blocked by plan mode: ${toolId}`);
  }
}

interface ThreadState {
  mode: PlanMode;
  pending: PendingReminder[];
  messageCountSinceLastReminder: number;
  lastAssistantHadToolCall: boolean;
  lastAssistantCalledTodoWrite: boolean;
}

export interface PlanModeControllerOptions {
  readonly logger?: Logger;
  readonly todoStore: TodoStore;
  readonly allowlist?: ReadonlySet<string>;
  readonly staleTodoThreshold?: () => number;
  readonly todoKeyFor?: (thread: ThreadId, agentId: string | null) => string;
}

function defaultTodoKey(thread: ThreadId, agentId: string | null): string {
  return agentId !== null && agentId.length > 0 ? agentId : thread;
}

export class PlanModeController {
  private readonly logger: Logger | undefined;
  private readonly todoStore: TodoStore;
  private readonly allowlist: ReadonlySet<string>;
  private readonly threshold: () => number;
  private readonly todoKeyFor: (thread: ThreadId, agentId: string | null) => string;
  private readonly byThread = new Map<ThreadId, ThreadState>();

  constructor(opts: PlanModeControllerOptions) {
    this.logger = opts.logger;
    this.todoStore = opts.todoStore;
    this.allowlist = opts.allowlist ?? DEFAULT_PLAN_MODE_ALLOWLIST;
    this.threshold = opts.staleTodoThreshold ?? ((): number => DEFAULT_STALE_TODO_THRESHOLD);
    this.todoKeyFor = opts.todoKeyFor ?? defaultTodoKey;
  }

  getMode(thread: ThreadId): PlanMode {
    return this.byThread.get(thread)?.mode ?? 'normal';
  }

  isToolAllowedInPlan(toolId: string): boolean {
    return this.allowlist.has(toolId);
  }

  enterPlan(thread: ThreadId): void {
    const state = this.ensure(thread);
    state.mode = 'plan';
    this.logger?.info('plan.mode.enter', { threadId: thread });
    this.enqueueReminder(thread, { kind: 'plan-enter', body: PLAN_ENTER_REMINDER });
  }

  exitPlan(thread: ThreadId): void {
    const state = this.ensure(thread);
    state.mode = 'normal';
    this.logger?.info('plan.mode.exit', { threadId: thread });
    this.enqueueReminder(thread, { kind: 'plan-exit', body: PLAN_EXIT_REMINDER });
  }

  drainAttachments(thread: ThreadId): readonly PendingReminder[] {
    const state = this.byThread.get(thread);
    if (state === undefined || state.pending.length === 0) return [];
    const drained: readonly PendingReminder[] = [...state.pending];
    state.pending.length = 0;
    for (const reminder of drained) {
      this.logger?.info('plan.attachment.flushed', {
        threadId: thread,
        kind: reminder.kind,
      });
    }
    return drained;
  }

  peekAttachments(thread: ThreadId): readonly PendingReminder[] {
    return this.byThread.get(thread)?.pending ?? [];
  }

  recordToolBlocked(thread: ThreadId, toolId: string): void {
    this.logger?.info('plan.mode.tool-blocked', { threadId: thread, toolId });
  }

  recordSubagentReject(thread: ThreadId, toolId: string): void {
    this.logger?.warn('plan.mode.subagent-reject', { threadId: thread, toolId });
  }

  /**
   * Called once per assistant turn. `hasToolCall` is true when the assistant
   * produced ≥ 1 tool_call event; `calledTodoWrite` is true when at least one
   * of those calls was `TodoWrite`.
   */
  recordAssistantTurn(
    thread: ThreadId,
    summary: { hasToolCall: boolean; calledTodoWrite: boolean },
  ): void {
    const state = this.ensure(thread);
    state.lastAssistantHadToolCall = summary.hasToolCall;
    state.lastAssistantCalledTodoWrite = summary.calledTodoWrite;
    state.messageCountSinceLastReminder += 1;
  }

  maybeInjectStaleTodoReminder(thread: ThreadId, agentId: string | null = null): string | null {
    const state = this.ensure(thread);
    const key = this.todoKeyFor(thread, agentId);
    const todos = this.todoStore.get(key);
    if (todos.length === 0) {
      this.logger?.debug('plan.stale-todo.suppressed', {
        threadId: thread,
        reason: 'empty' satisfies StaleTodoSuppressReason,
      });
      return null;
    }
    if (state.lastAssistantCalledTodoWrite) {
      this.logger?.debug('plan.stale-todo.suppressed', {
        threadId: thread,
        reason: 'todowrite-called' satisfies StaleTodoSuppressReason,
      });
      return null;
    }
    if (!state.lastAssistantHadToolCall) {
      this.logger?.debug('plan.stale-todo.suppressed', {
        threadId: thread,
        reason: 'todowrite-called' satisfies StaleTodoSuppressReason,
      });
      return null;
    }
    if (state.messageCountSinceLastReminder < this.threshold()) {
      this.logger?.debug('plan.stale-todo.suppressed', {
        threadId: thread,
        reason: 'rate-limit' satisfies StaleTodoSuppressReason,
      });
      return null;
    }
    state.messageCountSinceLastReminder = 0;
    this.logger?.info('plan.stale-todo.reminder', { threadId: thread });
    return STALE_TODO_REMINDER;
  }

  reset(thread: ThreadId): void {
    this.byThread.delete(thread);
  }

  dispose(): void {
    this.byThread.clear();
  }

  private ensure(thread: ThreadId): ThreadState {
    let state = this.byThread.get(thread);
    if (state === undefined) {
      state = {
        mode: 'normal',
        pending: [],
        messageCountSinceLastReminder: 0,
        lastAssistantHadToolCall: false,
        lastAssistantCalledTodoWrite: false,
      };
      this.byThread.set(thread, state);
    }
    return state;
  }

  private enqueueReminder(thread: ThreadId, reminder: PendingReminder): void {
    const state = this.ensure(thread);
    const tail = state.pending[state.pending.length - 1];
    if (tail !== undefined && isOpposite(tail.kind, reminder.kind)) {
      state.pending.pop();
      this.logger?.info('plan.attachment.cleared-opposing', {
        threadId: thread,
        droppedKinds: [tail.kind, reminder.kind],
      });
      return;
    }
    state.pending.push(reminder);
    this.logger?.info('plan.attachment.queued', {
      threadId: thread,
      kind: reminder.kind,
    });
  }
}

function isOpposite(a: PendingReminderKind, b: PendingReminderKind): boolean {
  return (a === 'plan-enter' && b === 'plan-exit') || (a === 'plan-exit' && b === 'plan-enter');
}
