import type { Logger } from '@/platform/Logger';
import type { Skill, SkillExample } from './types';
import type { SkillsStore } from './skillsStore';

export interface SkillEditorStoreLike {
  list(): readonly Skill[];
  get(id: string): Skill | undefined;
  save(skill: Skill): Promise<void>;
  delete(id: string): Promise<void>;
  cloneBuiltin(sourceId: string, newId: string): Promise<Skill>;
}

export interface SkillDraft {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly allowedTools: readonly string[];
  readonly examples: readonly SkillExample[];
  readonly defaultModel: string | null;
}

export interface SkillValidationError {
  readonly field: keyof SkillDraft | 'id-duplicate';
  readonly message: string;
}

export interface ThreadBindingsLookup {
  countBound(skillId: string): number;
}

export interface NoticeLike {
  notify(message: string): void;
}

export interface SkillEditorOptions {
  readonly store: SkillEditorStoreLike;
  readonly logger?: Logger;
  readonly idGenerator?: () => string;
  readonly threadBindings?: ThreadBindingsLookup;
  readonly notice?: NoticeLike;
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export class SkillEditorController {
  private readonly store: SkillEditorStoreLike;
  private readonly logger: Logger | undefined;
  private readonly idGenerator: () => string;
  private readonly threadBindings: ThreadBindingsLookup | null;
  private readonly notice: NoticeLike | null;

  constructor(opts: SkillEditorOptions) {
    this.store = opts.store;
    this.logger = opts.logger;
    this.idGenerator = opts.idGenerator ?? defaultIdGenerator;
    this.threadBindings = opts.threadBindings ?? null;
    this.notice = opts.notice ?? null;
  }

  list(): readonly Skill[] {
    return this.store.list();
  }

  openDraftForNew(): SkillDraft {
    const existingIds = new Set(this.store.list().map((s) => s.id));
    let candidate = this.idGenerator();
    let guard = 0;
    while (existingIds.has(candidate) && guard < 100) {
      candidate = `${this.idGenerator()}-${guard}`;
      guard += 1;
    }
    return {
      id: candidate,
      name: 'New Skill',
      description: '',
      systemPrompt: '',
      allowedTools: [],
      examples: [],
      defaultModel: null,
    };
  }

  openDraftForEdit(id: string): SkillDraft | null {
    const skill = this.store.get(id);
    if (skill === undefined) return null;
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      systemPrompt: skill.systemPrompt,
      allowedTools: skill.allowedTools ? [...skill.allowedTools] : [],
      examples: skill.examples ? [...skill.examples] : [],
      defaultModel: skill.defaultModel ?? null,
    };
  }

  isEditable(id: string): boolean {
    const skill = this.store.get(id);
    if (skill === undefined) return false;
    return skill.source === 'user';
  }

  validate(draft: SkillDraft, mode: 'create' | 'edit'): readonly SkillValidationError[] {
    const out: SkillValidationError[] = [];
    if (draft.id.length === 0) {
      out.push({ field: 'id', message: 'id is required' });
    } else if (!KEBAB_RE.test(draft.id)) {
      out.push({ field: 'id', message: 'id must be lowercase-kebab (a-z0-9 with single hyphens)' });
    }
    if (draft.name.trim().length === 0) out.push({ field: 'name', message: 'name is required' });
    if (draft.systemPrompt.trim().length === 0) {
      out.push({ field: 'systemPrompt', message: 'systemPrompt is required' });
    }
    if (mode === 'create' && out.every((e) => e.field !== 'id')) {
      const collision = this.store.list().some((s) => s.id === draft.id);
      if (collision) {
        out.push({ field: 'id-duplicate', message: `id "${draft.id}" already exists` });
      }
    }
    for (let i = 0; i < draft.examples.length; i += 1) {
      const ex = draft.examples[i]!;
      if (typeof ex.user !== 'string' || typeof ex.assistant !== 'string') {
        out.push({ field: 'examples', message: `examples[${i}] must have user+assistant strings` });
        break;
      }
    }
    return out;
  }

  async save(
    draft: SkillDraft,
    mode: 'create' | 'edit',
  ): Promise<
    | { ok: true; skill: Skill }
    | { ok: false; errors: readonly SkillValidationError[] }
    | { ok: false; error: string }
  > {
    const errors = this.validate(draft, mode);
    if (errors.length > 0) return { ok: false, errors };
    const skill: Skill = {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      ...(draft.allowedTools.length > 0 ? { allowedTools: draft.allowedTools } : {}),
      ...(draft.examples.length > 0 ? { examples: draft.examples } : {}),
      ...(draft.defaultModel !== null && draft.defaultModel.length > 0
        ? { defaultModel: draft.defaultModel }
        : {}),
      source: 'user',
    };
    try {
      await this.store.save(skill);
      this.logger?.info('skills.editor.save', { id: skill.id, source: skill.source });
      this.notice?.notify(`Skill "${skill.name}" saved`);
      return { ok: true, skill };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.error('skills.editor.save-failed', { id: draft.id, error: msg });
      this.notice?.notify(`Failed to save skill: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  boundThreadCount(id: string): number {
    if (this.threadBindings === null) return 0;
    return this.threadBindings.countBound(id);
  }

  deleteConfirmationMessage(id: string): string {
    const skill = this.store.get(id);
    if (skill === undefined) return `Delete skill ${id}?`;
    const count = this.boundThreadCount(id);
    const suffix =
      count > 0 ? ` ${count} thread${count === 1 ? '' : 's'} will fall back to General.` : '';
    return `Delete skill ${skill.name}?${suffix}`;
  }

  async deleteUserSkill(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const skill = this.store.get(id);
    if (skill === undefined) return { ok: false, error: `unknown skill: ${id}` };
    if (skill.source !== 'user') return { ok: false, error: `cannot delete builtin skill: ${id}` };
    try {
      await this.store.delete(id);
      this.logger?.info('skills.editor.delete', { id, source: skill.source });
      this.notice?.notify(`Skill "${skill.name}" deleted`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.error('skills.editor.delete-failed', { id, error: msg });
      this.notice?.notify(`Failed to delete skill: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async duplicate(
    sourceId: string,
  ): Promise<{ ok: true; skill: Skill } | { ok: false; error: string }> {
    const source = this.store.get(sourceId);
    if (source === undefined) return { ok: false, error: `unknown skill: ${sourceId}` };
    const baseId = `${source.id}-copy`;
    const existingIds = new Set(this.store.list().map((s) => s.id));
    let candidate = baseId;
    let n = 1;
    while (existingIds.has(candidate) && n < 100) {
      n += 1;
      candidate = `${baseId}-${n}`;
    }
    try {
      let skill: Skill;
      if (source.source === 'builtin') {
        skill = await this.store.cloneBuiltin(sourceId, candidate);
      } else {
        skill = {
          ...source,
          id: candidate,
          name: `${source.name} (copy)`,
          source: 'user',
        };
        await this.store.save(skill);
      }
      this.logger?.info('skills.editor.duplicate', { fromId: sourceId, newId: skill.id });
      this.notice?.notify(`Skill duplicated as "${skill.name}"`);
      return { ok: true, skill };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.error('skills.editor.duplicate-failed', { sourceId, error: msg });
      this.notice?.notify(`Failed to duplicate skill: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  isDirty(original: SkillDraft, current: SkillDraft): boolean {
    return (
      original.id !== current.id ||
      original.name !== current.name ||
      original.description !== current.description ||
      original.systemPrompt !== current.systemPrompt ||
      !stringArrayEqual(original.allowedTools, current.allowedTools) ||
      !exampleArrayEqual(original.examples, current.examples) ||
      original.defaultModel !== current.defaultModel
    );
  }
}

export type UnsavedChangesDecision = 'save' | 'discard' | 'cancel';

export interface UnsavedChangesPrompt {
  readonly original: SkillDraft;
  readonly current: SkillDraft;
  readonly onDecision: (decision: UnsavedChangesDecision) => void;
}

export function maybePrompt(
  controller: SkillEditorController,
  original: SkillDraft,
  current: SkillDraft,
  openPrompt: (p: UnsavedChangesPrompt) => void,
  onClean: () => void,
): void {
  if (!controller.isDirty(original, current)) {
    onClean();
    return;
  }
  openPrompt({
    original,
    current,
    onDecision: (decision) => {
      if (decision === 'cancel') return;
      if (decision === 'discard') {
        onClean();
        return;
      }
      void controller
        .save(current, controller.list().some((s) => s.id === current.id) ? 'edit' : 'create')
        .then((res) => {
          if (res.ok) onClean();
        });
    },
  });
}

function stringArrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function exampleArrayEqual(a: readonly SkillExample[], b: readonly SkillExample[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.user !== b[i]!.user) return false;
    if (a[i]!.assistant !== b[i]!.assistant) return false;
  }
  return true;
}

function defaultIdGenerator(): string {
  return `skill-${Math.random().toString(36).slice(2, 8)}`;
}

export type { SkillsStore };
