import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPlanEnterReminder,
  buildStaleTodoReminder,
  PLAN_EXIT_REMINDER,
  PlanModeController,
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

  const PLAN_PATH = '.leo/plans/foo-bar.md';

  it('defaults mode to normal and flips to plan on enterPlan', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    expect(c.getMode('t-1')).toBe('normal');
    c.enterPlan('t-1', PLAN_PATH);
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
    c.enterPlan('t-1', PLAN_PATH);
    c.drainAttachments('t-1');
    c.exitPlan('t-1');
    expect(c.getMode('t-1')).toBe('normal');
    const attachments = c.drainAttachments('t-1');
    expect(attachments.map((r) => r.kind)).toEqual(['plan-exit']);
    expect(attachments[0]?.body).toBe(PLAN_EXIT_REMINDER);
    expect(events.some((e) => e.event === 'plan.mode.exit')).toBe(true);
  });

  it('plan-enter reminder embeds the plan file path and is wrapped in <system-reminder> tags', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1', PLAN_PATH);
    const [enter] = c.drainAttachments('t-1');
    expect(enter?.body).toBe(buildPlanEnterReminder(PLAN_PATH));
    expect(enter?.body.startsWith('<system-reminder>')).toBe(true);
    expect(enter?.body.endsWith('</system-reminder>')).toBe(true);
    expect(enter?.body).toContain(PLAN_PATH);
  });

  it('flushes pending attachments on drain and empties the queue', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1', PLAN_PATH);
    expect(c.drainAttachments('t-1').length).toBe(1);
    expect(c.drainAttachments('t-1').length).toBe(0);
    expect(events.filter((e) => e.event === 'plan.attachment.flushed').length).toBe(1);
  });

  it('opposing-flag clearing drops both entries on rapid enter→exit before drain', () => {
    const { logger, events } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    c.enterPlan('t-1', PLAN_PATH);
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
    c.enterPlan('t-1', PLAN_PATH);
    expect(c.drainAttachments('t-1').length).toBe(0);
  });

  it('allowlist passes read tools + TodoWrite + AskUserQuestion + open_note + reveal_in_note; denies write tools', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    for (const id of [
      'Read',
      'Grep',
      'Glob',
      'WebFetch',
      'EnterPlanMode',
      'ExitPlanMode',
      'TodoWrite',
      'AskUserQuestion',
      'read_note',
      'read_file',
      'search_vault',
      'list_notes',
      'glob_vault',
      'grep_vault',
      'open_note',
      'reveal_in_note',
    ]) {
      expect(c.isToolAllowedInPlan(id)).toBe(true);
    }
    for (const id of [
      'create_note',
      'append_to_note',
      'edit_note',
      'create_folder',
      'delegate_external',
    ]) {
      expect(c.isToolAllowedInPlan(id)).toBe(false);
    }
  });

  it('buildStaleTodoReminder formats todos as [N. [status] content] joined with newlines', () => {
    const todos: readonly Todo[] = [
      { id: 't1', content: 'create hub note', status: 'pending' },
      { id: 't2', content: 'wire backlinks', status: 'in-progress' },
      { id: 't3', content: 'review structure', status: 'completed' },
    ];
    const out = buildStaleTodoReminder(todos);
    expect(out).toContain('[1. [pending] create hub note');
    expect(out).toContain('2. [in-progress] wire backlinks');
    expect(out).toContain('3. [completed] review structure]');
    expect(out.startsWith('<system-reminder>')).toBe(true);
    expect(out.endsWith('</system-reminder>')).toBe(true);
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
    expect(reminder).toBe(buildStaleTodoReminder(TODOS));
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
    expect(c.maybeInjectStaleTodoReminder('t-1')).toBe(buildStaleTodoReminder(TODOS));
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
    c.enterPlan('t-1', PLAN_PATH);
    c.dispose();
    expect(c.getMode('t-1')).toBe('normal');
    expect(c.drainAttachments('t-1').length).toBe(0);
  });

  it('subscribe fires on enterPlan and exitPlan; unsubscribe stops further calls', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    let calls = 0;
    const off = c.subscribe(() => {
      calls += 1;
    });
    c.enterPlan('t-1', PLAN_PATH);
    expect(calls).toBe(1);
    c.exitPlan('t-1');
    expect(calls).toBe(2);
    off();
    c.enterPlan('t-1', PLAN_PATH);
    expect(calls).toBe(2);
  });

  it('reset notifies only when state existed for the thread', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    let calls = 0;
    c.subscribe(() => {
      calls += 1;
    });
    c.reset('never-existed');
    expect(calls).toBe(0);
    c.enterPlan('t-1', PLAN_PATH);
    expect(calls).toBe(1);
    c.reset('t-1');
    expect(calls).toBe(2);
  });

  it('toggle scenario: enterPlan → exitPlan flips getMode both ways', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    expect(c.getMode('t-1')).toBe('normal');
    c.enterPlan('t-1', PLAN_PATH);
    expect(c.getMode('t-1')).toBe('plan');
    c.exitPlan('t-1');
    expect(c.getMode('t-1')).toBe('normal');
  });

  it('dispose clears listeners so post-dispose mutations do not fire callbacks', () => {
    const { logger } = newLogger();
    const c = new PlanModeController({ logger, todoStore: store });
    let calls = 0;
    c.subscribe(() => {
      calls += 1;
    });
    c.dispose();
    // Internal state cleared; further mode mutations should not fire to a stale listener.
    c.enterPlan('t-1', PLAN_PATH);
    expect(calls).toBe(0);
  });
});
