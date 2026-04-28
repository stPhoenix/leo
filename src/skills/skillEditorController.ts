import type { Logger } from '@/platform/Logger';
import { parseSkillMarkdown } from './parse';
import type { SkillsStore } from './skillsStore';
import type { Skill, SkillBlueprint } from './types';

export interface SkillEditorStoreLike {
  listAll(): readonly Skill[];
  find(name: string): Skill | undefined;
  writeSkill(
    blueprint: SkillBlueprint,
    raw: string,
  ): Promise<{ readonly skill: Skill; readonly path: string }>;
  deleteSkill(name: string): Promise<void>;
}

export interface SkillDraft {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly body: string;
  readonly allowedTools: readonly string[];
  readonly model: string | null;
  readonly paths: readonly string[];
  readonly argumentHint: string | null;
  readonly argNames: readonly string[];
  readonly disableModelInvocation: boolean;
  readonly userInvocable: boolean;
  readonly version: string | null;
}

export interface SkillValidationError {
  readonly field: keyof SkillDraft | 'name-duplicate';
  readonly message: string;
}

export interface NoticeLike {
  notify(message: string): void;
}

export interface SkillEditorOptions {
  readonly store: SkillEditorStoreLike;
  readonly logger?: Logger;
  readonly idGenerator?: () => string;
  readonly notice?: NoticeLike;
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export class SkillEditorController {
  private readonly store: SkillEditorStoreLike;
  private readonly logger: Logger | undefined;
  private readonly idGenerator: () => string;
  private readonly notice: NoticeLike | null;

  constructor(opts: SkillEditorOptions) {
    this.store = opts.store;
    this.logger = opts.logger;
    this.idGenerator = opts.idGenerator ?? defaultIdGenerator;
    this.notice = opts.notice ?? null;
  }

  list(): readonly Skill[] {
    return this.store.listAll();
  }

  openDraftForNew(): SkillDraft {
    const existing = new Set(this.store.listAll().map((s) => s.name));
    let candidate = this.idGenerator();
    let guard = 0;
    while (existing.has(candidate) && guard < 100) {
      candidate = `${this.idGenerator()}-${guard}`;
      guard += 1;
    }
    return {
      name: candidate,
      displayName: 'New Skill',
      description: '',
      whenToUse: '',
      body: '',
      allowedTools: [],
      model: null,
      paths: [],
      argumentHint: null,
      argNames: [],
      disableModelInvocation: false,
      userInvocable: true,
      version: null,
    };
  }

  openDraftForEdit(name: string): SkillDraft | null {
    const skill = this.store.find(name);
    if (skill === undefined) return null;
    return {
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      whenToUse: skill.whenToUse ?? '',
      body: '',
      allowedTools: [...skill.allowedTools],
      model: skill.model ?? null,
      paths: skill.paths !== undefined ? [...skill.paths] : [],
      argumentHint: skill.argumentHint ?? null,
      argNames: skill.argNames !== undefined ? [...skill.argNames] : [],
      disableModelInvocation: skill.disableModelInvocation,
      userInvocable: skill.userInvocable,
      version: skill.version ?? null,
    };
  }

  validate(draft: SkillDraft, mode: 'create' | 'edit'): readonly SkillValidationError[] {
    const out: SkillValidationError[] = [];
    if (draft.name.length === 0) {
      out.push({ field: 'name', message: 'name is required' });
    } else if (!KEBAB_RE.test(draft.name)) {
      out.push({ field: 'name', message: 'name must be lowercase-kebab' });
    }
    if (draft.displayName.trim().length === 0) {
      out.push({ field: 'displayName', message: 'displayName is required' });
    }
    if (draft.description.trim().length === 0) {
      out.push({ field: 'description', message: 'description is required' });
    }
    if (draft.body.trim().length === 0) {
      out.push({ field: 'body', message: 'body is required' });
    }
    if (mode === 'create' && out.every((e) => e.field !== 'name')) {
      if (this.store.find(draft.name) !== undefined) {
        out.push({ field: 'name-duplicate', message: `name "${draft.name}" already exists` });
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
    const raw = renderSkillFile(draft);
    const parsed = parseSkillMarkdown(raw, { canonicalName: draft.name });
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    try {
      const written = await this.store.writeSkill(parsed.skill, raw);
      this.logger?.info('skills.editor.save', { name: draft.name });
      this.notice?.notify(`Skill "${draft.displayName}" saved`);
      return { ok: true, skill: written.skill };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.error('skills.editor.save-failed', { name: draft.name, error: msg });
      this.notice?.notify(`Failed to save skill: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  async deleteUserSkill(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const skill = this.store.find(name);
    if (skill === undefined) return { ok: false, error: `unknown skill: ${name}` };
    try {
      await this.store.deleteSkill(name);
      this.logger?.info('skills.editor.delete', { name });
      this.notice?.notify(`Skill "${skill.displayName}" deleted`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.error('skills.editor.delete-failed', { name, error: msg });
      this.notice?.notify(`Failed to delete skill: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  isDirty(original: SkillDraft, current: SkillDraft): boolean {
    return (
      original.name !== current.name ||
      original.displayName !== current.displayName ||
      original.description !== current.description ||
      original.whenToUse !== current.whenToUse ||
      original.body !== current.body ||
      !arrayEqual(original.allowedTools, current.allowedTools) ||
      original.model !== current.model ||
      !arrayEqual(original.paths, current.paths) ||
      original.argumentHint !== current.argumentHint ||
      !arrayEqual(original.argNames, current.argNames) ||
      original.disableModelInvocation !== current.disableModelInvocation ||
      original.userInvocable !== current.userInvocable ||
      original.version !== current.version
    );
  }
}

function renderSkillFile(draft: SkillDraft): string {
  const fm: string[] = ['---'];
  fm.push(`name: ${yaml(draft.displayName)}`);
  fm.push(`description: ${yaml(draft.description)}`);
  if (draft.whenToUse.trim().length > 0) fm.push(`when_to_use: ${yaml(draft.whenToUse)}`);
  if (draft.allowedTools.length > 0) {
    fm.push(`allowed-tools: [${draft.allowedTools.map(yaml).join(', ')}]`);
  }
  if (draft.model !== null && draft.model.length > 0) fm.push(`model: ${yaml(draft.model)}`);
  if (draft.paths.length > 0) {
    fm.push(`paths: [${draft.paths.map(yaml).join(', ')}]`);
  }
  if (draft.argumentHint !== null && draft.argumentHint.length > 0) {
    fm.push(`argument-hint: ${yaml(draft.argumentHint)}`);
  }
  if (draft.argNames.length > 0) {
    fm.push(`arguments: [${draft.argNames.map(yaml).join(', ')}]`);
  }
  if (draft.disableModelInvocation) fm.push('disable-model-invocation: true');
  if (!draft.userInvocable) fm.push('user-invocable: false');
  if (draft.version !== null && draft.version.length > 0)
    fm.push(`version: ${yaml(draft.version)}`);
  fm.push('---');
  return `${fm.join('\n')}\n\n${draft.body.trim()}\n`;
}

function yaml(value: string): string {
  if (value.length === 0) return '""';
  if (/[:#[\]{},&*!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function arrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function defaultIdGenerator(): string {
  return `skill-${Math.random().toString(36).slice(2, 8)}`;
}

export type { SkillsStore };
