import type { Logger } from '@/platform/Logger';
import type { Todo, TodoStore } from './todoStore';
import type { ThreadId } from './types';

export type PlanMode = 'normal' | 'plan';

export type PendingReminderKind = 'plan-enter' | 'plan-exit';

export interface PendingReminder {
  readonly kind: PendingReminderKind;
  readonly body: string;
}

export type StaleTodoSuppressReason = 'empty' | 'rate-limit' | 'todowrite-called';

export function buildPlanEnterReminder(planFilePath: string): string {
  return [
    '<system-reminder>',
    'Plan mode is now active. Available tools: read_note, read_file, search_vault, list_notes, glob_vault, grep_vault, open_note, reveal_in_note, reveal_in_canvas, TodoWrite, AskUserQuestion, ExitPlanMode, delegate_canvas_create, delegate_canvas_content_edit, delegate_canvas_layout_edit. Write-capable tools (create_note, edit_note, append_to_note, create_folder, rename_note, move_note, copy_note, delete_note, delete_folder, delegate_external, task) are blocked. Canvas delegates are visible but each requires explicit user confirmation; only invoke them after ExitPlanMode is approved.',
    '',
    'Explore the vault, design the note structure (which notes to create or edit, how they link, headings, frontmatter), and present your plan via ExitPlanMode when ready. Use AskUserQuestion if a structural choice depends on user preference.',
    '',
    `When approved, your plan will be saved to: ${planFilePath}`,
    '</system-reminder>',
  ].join('\n');
}

export const PLAN_EXIT_REMINDER =
  '<system-reminder>\nPlan mode is now inactive. Write-capable tools are available again.\n</system-reminder>';

export function buildStaleTodoReminder(todos: readonly Todo[]): string {
  const formatted = todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join('\n');
  return [
    '<system-reminder>',
    "The TodoWrite tool hasn't been used recently. If you're working on tasks that would benefit from tracking progress, consider using the TodoWrite tool to track progress. Also consider cleaning up the todo list if it has become stale and no longer matches what you are working on. Only use it if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user",
    '',
    'Here are the existing contents of your todo list:',
    '',
    `[${formatted}]`,
    '</system-reminder>',
  ].join('\n');
}

export const DEFAULT_PLAN_MODE_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'EnterPlanMode',
  'ExitPlanMode',
  'TodoWrite',
  'AskUserQuestion',
  'ToolSearch',
  'read_note',
  'read_file',
  'search_vault',
  'search_wiki',
  'list_notes',
  'glob_vault',
  'grep_vault',
  'open_note',
  'reveal_in_note',
  'reveal_in_canvas',
  // Canvas delegates each require explicit user confirmation per call, so plan
  // mode visibility is safe — and required so the canvas-create skill's model
  // can see the tool exists before calling ExitPlanMode.
  'delegate_canvas_create',
  'delegate_canvas_content_edit',
  'delegate_canvas_layout_edit',
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
  private readonly listeners = new Set<() => void>();

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

  enterPlan(thread: ThreadId, planFilePath: string): void {
    const state = this.ensure(thread);
    state.mode = 'plan';
    this.logger?.info('plan.mode.enter', { threadId: thread, planFilePath });
    this.enqueueReminder(thread, {
      kind: 'plan-enter',
      body: buildPlanEnterReminder(planFilePath),
    });
    this.notify();
  }

  exitPlan(thread: ThreadId): void {
    const state = this.ensure(thread);
    state.mode = 'normal';
    this.logger?.info('plan.mode.exit', { threadId: thread });
    this.enqueueReminder(thread, { kind: 'plan-exit', body: PLAN_EXIT_REMINDER });
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
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
    return buildStaleTodoReminder(todos);
  }

  reset(thread: ThreadId): void {
    const had = this.byThread.delete(thread);
    if (had) this.notify();
  }

  dispose(): void {
    this.byThread.clear();
    this.listeners.clear();
  }

  private notify(): void {
    for (const l of this.listeners) l();
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
