import { describe, expect, it } from 'vitest';
import { PlanSessionResume } from '@/agent/planSessionResume';
import { TodoStore, type Todo } from '@/agent/todoStore';
import { PlanStore } from '@/storage/planStore';
import type { StoredMessage, StoredThread } from '@/storage/conversationSchema';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type {
  LogFields,
  LogLevel,
  LogRecord,
  LogSink,
  UserErrorChannel,
} from '@/platform/logTypes';
import { Logger } from '@/platform/Logger';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()], folders: [] };
  }
}

interface Captured {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
}

function newLogger(): { logger: Logger; events: Captured[] } {
  const events: Captured[] = [];
  const sink: LogSink = {
    async write(r: LogRecord): Promise<void> {
      events.push({ level: r.level, event: r.event, fields: r.fields });
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
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
  return { logger, events };
}

function thread(messages: readonly StoredMessage[]): StoredThread {
  return {
    id: 't-1',
    schemaVersion: 1,
    createdAt: '2026-04-21T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
    metadata: { allowedTools: [], skillId: null },
    messages,
  };
}

function assistantToolUse(id: string, toolUse: unknown): StoredMessage {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt: '2026-04-21T00:00:00Z',
    toolUse,
  };
}

function userMessage(id: string, content: string, extras?: Record<string, unknown>): StoredMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: '2026-04-21T00:00:00Z',
    ...(extras !== undefined ? { extras } : {}),
  };
}

const TODOS: readonly Todo[] = [
  { id: 't1', content: 'step 1', status: 'pending' },
  { id: 't2', content: 'step 2', status: 'in-progress' },
];

describe('PlanSessionResume', () => {
  it('emits plan.resume.start and skipped on empty transcript', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(thread([]));
    expect(events.some((e) => e.event === 'plan.resume.start')).toBe(true);
    expect(
      events.some(
        (e) => e.event === 'plan.resume.skipped' && e.fields.reason === 'empty-transcript',
      ),
    ).toBe(true);
  });

  it('replays latest-wins TodoWrite into the TodoStore and emits rehydrated event', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([
        assistantToolUse('a1', {
          name: 'TodoWrite',
          input: { newTodos: [{ id: 'old', content: 'stale', status: 'pending' }] },
        }),
        userMessage('u1', 'work more'),
        assistantToolUse('a2', { name: 'TodoWrite', input: { newTodos: TODOS } }),
      ]),
    );
    expect(todoStore.get('t-1')).toEqual(TODOS);
    const hit = events.find((e) => e.event === 'plan.resume.todos.rehydrated');
    expect(hit?.fields.count).toBe(2);
  });

  it('silently rejects invalid TodoWrite payloads with count=0 log', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([
        assistantToolUse('a1', {
          name: 'TodoWrite',
          input: { newTodos: [{ id: 'x' /* missing content/status */ }] },
        }),
      ]),
    );
    expect(todoStore.get('t-1')).toEqual([]);
    const hit = events.find(
      (e) => e.event === 'plan.resume.todos.rehydrated' && e.fields.reason === 'validation-failed',
    );
    expect(hit?.fields.count).toBe(0);
  });

  it('emits todos.none when no TodoWrite is in transcript', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(thread([userMessage('u1', 'just chatting')]));
    expect(events.some((e) => e.event === 'plan.resume.todos.none')).toBe(true);
  });

  it('recovers plan from file_snapshot tier and writes through PlanStore.writePlan', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([
        userMessage('u1', 'plan please', {
          fileSnapshot: { path: '.leo/plans/x.md', content: '# Snapshot plan body' },
        }),
      ]),
    );
    // PlanStore writes at its slug; ensure exactly one file exists containing the content
    const files = [...vault.files.values()];
    expect(files).toContain('# Snapshot plan body');
    expect(events.some((e) => e.event === 'plan.resume.plan.snapshot-hit')).toBe(true);
    expect(
      events.some((e) => e.event === 'plan.resume.plan.write' && e.fields.tier === 'snapshot'),
    ).toBe(true);
  });

  it('falls through to ExitPlanMode tool_use when no snapshot is present', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([
        assistantToolUse('a1', { name: 'ExitPlanMode', input: { plan: '# from tool_use' } }),
      ]),
    );
    const files = [...vault.files.values()];
    expect(files).toContain('# from tool_use');
    expect(events.some((e) => e.event === 'plan.resume.plan.tooluse-hit')).toBe(true);
  });

  it('falls through to user attachment planContent when snapshot and tool_use missing', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([userMessage('u1', 'here is my plan', { planContent: '# inline attachment' })]),
    );
    const files = [...vault.files.values()];
    expect(files).toContain('# inline attachment');
    expect(events.some((e) => e.event === 'plan.resume.plan.attachment-hit')).toBe(true);
  });

  it('resolves plan_file_reference via VaultAdapter.read when no inline content exists', async () => {
    const vault = new FakeVault();
    vault.files.set('user/plans/shared.md', '# referenced body');
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, vault, logger });
    await r.resume(
      thread([
        userMessage('u1', 'see attached', {
          plan_file_reference: { path: 'user/plans/shared.md' },
        }),
      ]),
    );
    const files = [...vault.files.values()];
    expect(files).toContain('# referenced body');
  });

  it('stops at first non-empty tier — snapshot wins over tool_use + attachment', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([
        assistantToolUse('a1', { name: 'ExitPlanMode', input: { plan: '# tool-use body' } }),
        userMessage('u1', 'see attached', { planContent: '# attachment body' }),
        userMessage('u2', 'snapshot', { fileSnapshot: { path: 'x', content: '# snapshot body' } }),
      ]),
    );
    const files = [...vault.files.values()];
    expect(files).toContain('# snapshot body');
    expect(files).not.toContain('# tool-use body');
    expect(files).not.toContain('# attachment body');
    expect(events.some((e) => e.event === 'plan.resume.plan.snapshot-hit')).toBe(true);
    expect(events.some((e) => e.event === 'plan.resume.plan.tooluse-hit')).toBe(false);
  });

  it('logs plan.none when no recovery tier yields a hit', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(thread([userMessage('u1', 'chatting')]));
    expect(events.some((e) => e.event === 'plan.resume.plan.none')).toBe(true);
    expect([...vault.files.values()].length).toBe(0);
  });

  it('is idempotent — a second resume with the same transcript does not re-write when PlanStore.readPlan matches', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    const t = thread([
      assistantToolUse('a1', { name: 'ExitPlanMode', input: { plan: '# stable body' } }),
    ]);
    await r.resume(t);
    const writeCountBefore = events.filter((e) => e.event === 'plan.resume.plan.write').length;
    expect(writeCountBefore).toBe(1);
    await r.resume(t);
    const skippedUnchanged = events.filter(
      (e) => e.event === 'plan.resume.skipped' && e.fields.reason === 'plan-unchanged',
    ).length;
    expect(skippedUnchanged).toBe(1);
    const writeCountAfter = events.filter((e) => e.event === 'plan.resume.plan.write').length;
    expect(writeCountAfter).toBe(1);
  });

  it('never logs plan or todo content above debug (info/warn/error stay metadata-only)', async () => {
    const vault = new FakeVault();
    const todoStore = new TodoStore();
    const planStore = new PlanStore({ vault });
    const { logger, events } = newLogger();
    const r = new PlanSessionResume({ todoStore, planStore, logger });
    await r.resume(
      thread([
        assistantToolUse('a1', { name: 'TodoWrite', input: { newTodos: TODOS } }),
        userMessage('u1', 'snapshot', {
          fileSnapshot: { path: 'x', content: '# SECRET plan body' },
        }),
      ]),
    );
    const leaked = events
      .filter((e) => e.level !== 'debug')
      .flatMap((e) => Object.values(e.fields).map((v) => String(v)))
      .filter((s) => s.includes('SECRET') || s.includes('step 1') || s.includes('step 2'));
    expect(leaked).toEqual([]);
  });
});
