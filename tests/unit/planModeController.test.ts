import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLAN_ENTER_REMINDER,
  PLAN_EXIT_REMINDER,
  PlanModeController,
  STALE_TODO_REMINDER,
} from '@/agent/planModeController';
import { TodoStore, type Todo } from '@/agent/todoStore';
import type {
  LogFields,
  LogLevel,
  LogRecord,
  LogSink,
  UserErrorChannel,
} from '@/platform/logTypes';
import { Logger } from '@/platform/Logger';

interface CapturedEvent {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
}

function newLogger(): { logger: Logger; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const sink: LogSink = {
    async write(record: LogRecord): Promise<void> {
      events.push({ level: record.level, event: record.event, fields: record.fields });
    },
    async flush(): Promise<void> {
      /* no-op */
    },
  };
  const channel: UserErrorChannel = {
    notify: (): void => undefined,
    setStatus: (): void => undefined,
    clearStatus: (): void => undefined,
  };
  const logger = new Logger({
    level: 'debug',
    sink,
    userChannel: channel,
    consoleImpl: {
      debug: (): void => undefined,
      info: (): void => undefined,
      warn: (): void => undefined,
      error: (): void => undefined,
    },
  });
  return { logger, events };
}

const TODOS: readonly Todo[] = [{ id: 't1', content: 'first', status: 'pending' }];

describe('PlanModeController', () => {
  let store: TodoStore;
  beforeEach(() => {
    store = new TodoStore();
  });

  it('defaults mode to normal and flips to plan on enterPlan', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    expect(c.getMode('t-1')).toBe('normal');
    c.enterPlan('t-1');
    expect(c.getMode('t-1')).toBe('plan');
    expect(events.some((e) => e.event === 'plan.mode.enter' && e.fields.threadId === 't-1')).toBe(
      true,
    );
    expect(
      events.some((e) => e.event === 'plan.attachment.queued' && e.fields.kind === 'plan-enter'),
    ).toBe(true);
  });

  it('exitPlan flips back to normal and queues plan-exit reminder', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1');
    c.drainAttachments('t-1');
    c.exitPlan('t-1');
    expect(c.getMode('t-1')).toBe('normal');
    const attachments = c.drainAttachments('t-1');
    expect(attachments.map((r) => r.kind)).toEqual(['plan-exit']);
    expect(attachments[0]?.body).toBe(PLAN_EXIT_REMINDER);
    expect(events.some((e) => e.event === 'plan.mode.exit')).toBe(true);
  });

  it('queues wrap reminder bodies with <system-reminder> tags byte-for-byte', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1');
    const [enter] = c.drainAttachments('t-1');
    expect(enter?.body).toBe(PLAN_ENTER_REMINDER);
    expect(enter?.body.startsWith('<system-reminder>')).toBe(true);
    expect(enter?.body.endsWith('</system-reminder>')).toBe(true);
  });

  it('flushes pending attachments on drain and empties the queue', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1');
    expect(c.drainAttachments('t-1').length).toBe(1);
    expect(c.drainAttachments('t-1').length).toBe(0);
    expect(events.filter((e) => e.event === 'plan.attachment.flushed').length).toBe(1);
  });

  it('opposing-flag clearing drops both entries on rapid enter→exit before drain', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1');
    c.exitPlan('t-1');
    const attachments = c.drainAttachments('t-1');
    expect(attachments.length).toBe(0);
    const cleared = events.find((e) => e.event === 'plan.attachment.cleared-opposing');
    expect(cleared).toBeTruthy();
    expect(cleared?.fields.droppedKinds).toEqual(['plan-enter', 'plan-exit']);
  });

  it('opposing-flag clearing also works exit→enter', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.exitPlan('t-1');
    c.enterPlan('t-1');
    expect(c.drainAttachments('t-1').length).toBe(0);
  });

  it('allowlist predicate passes Read/Grep/Glob/WebFetch/EnterPlanMode/ExitPlanMode and denies create_note', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    for (const id of [
      'Read',
      'Grep',
      'Glob',
      'WebFetch',
      'EnterPlanMode',
      'ExitPlanMode',
      'read_note',
    ]) {
      expect(c.isToolAllowedInPlan(id)).toBe(true);
    }
    for (const id of ['create_note', 'append_to_note', 'edit_note', 'TodoWrite']) {
      expect(c.isToolAllowedInPlan(id)).toBe(false);
    }
  });

  it('stale-todo reminder fires only when todos non-empty + rate-limit met + non-trivial work without TodoWrite', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({
      logger,
      todoStore: store,
      staleTodoThreshold: () => 2,
    });
    store.write('t-1', TODOS);
    // Not enough messages yet
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: false });
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBeNull();
    expect(
      events.some(
        (e) => e.event === 'plan.stale-todo.suppressed' && e.fields.reason === 'rate-limit',
      ),
    ).toBe(true);
    // Cross the threshold
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: false });
    const reminder = c.maybeInjectStaleTodoReminder('t-1');
    expect(reminder).toBe(STALE_TODO_REMINDER);
    expect(events.some((e) => e.event === 'plan.stale-todo.reminder')).toBe(true);
  });

  it('stale-todo suppressed with reason=empty when todos empty', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: false });
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBeNull();
    expect(
      events.some((e) => e.event === 'plan.stale-todo.suppressed' && e.fields.reason === 'empty'),
    ).toBe(true);
  });

  it('stale-todo suppressed with reason=todowrite-called when TodoWrite was invoked in last turn', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({
      logger,
      todoStore: store,
      staleTodoThreshold: () => 1,
    });
    store.write('t-1', TODOS);
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: true });
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBeNull();
    expect(
      events.some(
        (e) => e.event === 'plan.stale-todo.suppressed' && e.fields.reason === 'todowrite-called',
      ),
    ).toBe(true);
  });

  it('stale-todo rate-limit counter resets after a reminder fires', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({
      logger,
      todoStore: store,
      staleTodoThreshold: () => 2,
    });
    store.write('t-1', TODOS);
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: false });
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBeNull();
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: false });
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBe(STALE_TODO_REMINDER);
    // Counter reset — one more turn should not re-trigger
    c.recordAssistantTurn('t-1', { hasToolCall: true, calledTodoWrite: false });
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBeNull();
  });

  it('subagent-reject records a log event without changing mode', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.recordSubagentReject('t-1', 'EnterPlanMode');
    expect(c.getMode('t-1')).toBe('normal');
    const rejected = events.find((e) => e.event === 'plan.mode.subagent-reject');
    expect(rejected?.fields.toolId).toBe('EnterPlanMode');
  });

  it('tool-blocked log event records toolId + threadId', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.recordToolBlocked('t-1', 'create_note');
    const blocked = events.find((e) => e.event === 'plan.mode.tool-blocked');
    expect(blocked?.fields.toolId).toBe('create_note');
    expect(blocked?.fields.threadId).toBe('t-1');
  });

  it('dispose clears all state', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1');
    c.dispose();
    expect(c.getMode('t-1')).toBe('normal');
    expect(c.drainAttachments('t-1').length).toBe(0);
  });
});
