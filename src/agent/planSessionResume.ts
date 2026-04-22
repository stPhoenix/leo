import type { Logger } from '@/platform/Logger';
import type { PlanStore } from '@/storage/planStore';
import type { StoredMessage, StoredThread } from '@/storage/conversationSchema';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { TodoStore, Todo } from './todoStore';
import { validateTodo } from './todoStore';

export type PlanRecoveryTier = 'snapshot' | 'tooluse' | 'attachment';

export interface PlanSessionResumeOptions {
  readonly todoStore: TodoStore;
  readonly planStore: PlanStore;
  readonly vault?: VaultAdapter;
  readonly logger?: Logger;
  readonly todoKeyFor?: (thread: StoredThread, agentId: string | null) => string;
}

interface ToolUse {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

function defaultTodoKey(thread: StoredThread, agentId: string | null): string {
  return agentId !== null && agentId.length > 0 ? agentId : thread.id;
}

export class PlanSessionResume {
  private readonly todoStore: TodoStore;
  private readonly planStore: PlanStore;
  private readonly vault: VaultAdapter | null;
  private readonly logger: Logger | undefined;
  private readonly todoKeyFor: (thread: StoredThread, agentId: string | null) => string;

  constructor(opts: PlanSessionResumeOptions) {
    this.todoStore = opts.todoStore;
    this.planStore = opts.planStore;
    this.vault = opts.vault ?? null;
    this.logger = opts.logger;
    this.todoKeyFor = opts.todoKeyFor ?? defaultTodoKey;
  }

  async resume(thread: StoredThread, agentId: string | null = null): Promise<void> {
    this.logger?.info('plan.resume.start', { threadId: thread.id });
    if (thread.messages.length === 0) {
      this.logger?.info('plan.resume.skipped', { threadId: thread.id, reason: 'empty-transcript' });
      return;
    }
    this.rehydrateTodos(thread, agentId);
    await this.recoverPlan(thread);
  }

  private rehydrateTodos(thread: StoredThread, agentId: string | null): void {
    const hit = findLatestToolUse(thread.messages, 'TodoWrite');
    if (hit === null) {
      this.logger?.info('plan.resume.todos.none', { threadId: thread.id });
      return;
    }
    const rawTodos = hit.input.newTodos;
    if (!Array.isArray(rawTodos)) {
      this.logger?.info('plan.resume.todos.rehydrated', {
        threadId: thread.id,
        count: 0,
        reason: 'newTodos-not-array',
      });
      return;
    }
    const validated: Todo[] = [];
    for (const raw of rawTodos) {
      const res = validateTodo(raw);
      if (!res.ok) {
        this.logger?.info('plan.resume.todos.rehydrated', {
          threadId: thread.id,
          count: 0,
          reason: 'validation-failed',
        });
        return;
      }
      validated.push(res.value);
    }
    const key = this.todoKeyFor(thread, agentId);
    this.todoStore.write(key, validated);
    this.logger?.info('plan.resume.todos.rehydrated', {
      threadId: thread.id,
      count: validated.length,
    });
  }

  private async recoverPlan(thread: StoredThread): Promise<void> {
    const tiers: Array<() => Promise<string | null>> = [
      () => Promise.resolve(this.tierSnapshot(thread)),
      () => Promise.resolve(this.tierToolUse(thread)),
      () => this.tierAttachment(thread),
    ];
    let hit: { tier: PlanRecoveryTier; content: string } | null = null;
    const tierNames: readonly PlanRecoveryTier[] = ['snapshot', 'tooluse', 'attachment'];
    for (let i = 0; i < tiers.length; i += 1) {
      const content = await tiers[i]!();
      if (content !== null && content.length > 0) {
        hit = { tier: tierNames[i]!, content };
        this.logger?.info(`plan.resume.plan.${tierNames[i]}-hit`, { threadId: thread.id });
        break;
      }
    }
    if (hit === null) {
      this.logger?.info('plan.resume.plan.none', { threadId: thread.id });
      return;
    }
    let existing: string | null = null;
    try {
      existing = await this.planStore.readPlan();
    } catch {
      existing = null;
    }
    if (existing === hit.content) {
      this.logger?.info('plan.resume.skipped', {
        threadId: thread.id,
        reason: 'plan-unchanged',
        tier: hit.tier,
      });
      return;
    }
    await this.planStore.writePlan(hit.content);
    this.logger?.info('plan.resume.plan.write', { threadId: thread.id, tier: hit.tier });
  }

  private tierSnapshot(thread: StoredThread): string | null {
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const msg = thread.messages[i]!;
      const snap = extractFileSnapshot(msg);
      if (snap === null) continue;
      return snap;
    }
    return null;
  }

  private tierToolUse(thread: StoredThread): string | null {
    const hit = findLatestToolUse(thread.messages, 'ExitPlanMode');
    if (hit === null) return null;
    const plan = hit.input.plan;
    if (typeof plan !== 'string' || plan.length === 0) return null;
    return plan;
  }

  private async tierAttachment(thread: StoredThread): Promise<string | null> {
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const msg = thread.messages[i]!;
      if (msg.role !== 'user') continue;
      const inline = readAttachmentContent(msg);
      if (inline !== null && inline.length > 0) return inline;
      const ref = readAttachmentReference(msg);
      if (ref !== null && this.vault !== null) {
        try {
          return await this.vault.read(ref);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

function findLatestToolUse(messages: readonly StoredMessage[], name: string): ToolUse | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== 'assistant') continue;
    const uses = extractToolUses(msg.toolUse);
    for (const use of uses) {
      if (use.name === name) return use;
    }
  }
  return null;
}

function extractToolUses(raw: unknown): readonly ToolUse[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    const out: ToolUse[] = [];
    for (const entry of raw) {
      for (const u of extractToolUses(entry)) out.push(u);
    }
    return out;
  }
  if (typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string') return [];
  const input =
    obj.input !== null && typeof obj.input === 'object'
      ? (obj.input as Record<string, unknown>)
      : {};
  return [{ name: obj.name, input }];
}

function extractFileSnapshot(msg: StoredMessage): string | null {
  const candidates: unknown[] = [
    msg.extras?.fileSnapshot,
    msg.extras?.file_snapshot,
    msg.banner?.kind === 'file_snapshot' ? msg.extras?.snapshot : undefined,
  ];
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    if (typeof c !== 'object') continue;
    const obj = c as Record<string, unknown>;
    const content = obj.content;
    if (typeof content === 'string' && content.length > 0) return content;
  }
  return null;
}

function readAttachmentContent(msg: StoredMessage): string | null {
  const extras = msg.extras;
  if (extras === undefined) return null;
  const direct = extras.planContent;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const ref = extras.plan_file_reference ?? extras.planFileReference;
  if (ref !== null && typeof ref === 'object') {
    const content = (ref as Record<string, unknown>).content;
    if (typeof content === 'string' && content.length > 0) return content;
  }
  return null;
}

function readAttachmentReference(msg: StoredMessage): string | null {
  const extras = msg.extras;
  if (extras === undefined) return null;
  const ref = extras.plan_file_reference ?? extras.planFileReference;
  if (ref === null || typeof ref !== 'object') return null;
  const path = (ref as Record<string, unknown>).path;
  if (typeof path !== 'string' || path.length === 0) return null;
  return path;
}
