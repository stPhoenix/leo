// Doc §2/§5 loader. Leo deviations:
//   - Single root (<vault>/.leo/skills/) instead of the managed/user/project
//     precedence tree; `--add-dir` and plugin dirs are not supported.
//   - Dedup by normalized path string, not realpath (Obsidian vault exposes
//     posix-style relative paths only).

import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { applySubstitutions } from './substitutions';
import { evaluateShellInBody, containsShellExpression } from './shellExec';
import { migrateLegacySkills } from './migration';
import { parseSkillMarkdown } from './parse';
import { createSignal, type Signal } from './signals';
import type {
  InvocationContext,
  InvocationMessage,
  InvocationResult,
  Skill,
  SkillBlueprint,
} from './types';

const DEFAULT_DIR = '.leo/skills';
const SKILL_FILE = 'SKILL.md';

export interface SkillsStoreOptions {
  readonly vault: VaultAdapter;
  readonly logger?: Logger;
  readonly dir?: string;
  readonly noticeChannel?: { notify(message: string): void } | null;
}

export interface SkillEntry {
  readonly skill: Skill;
  readonly path: string;
  readonly blueprint: SkillBlueprint;
}

export class SkillsStore {
  private readonly vault: VaultAdapter;
  private readonly logger: Logger | undefined;
  private readonly dir: string;
  private readonly noticeChannel: { notify(message: string): void } | null;
  private readonly unconditional = new Map<string, SkillEntry>();
  private readonly conditional = new Map<string, SkillEntry>();
  private readonly activatedConditional = new Set<string>();
  private loaded = false;
  private noticeFiredThisLoad = false;
  readonly changed: Signal<void> = createSignal<void>();

  constructor(opts: SkillsStoreOptions) {
    this.vault = opts.vault;
    this.logger = opts.logger;
    this.dir = opts.dir ?? DEFAULT_DIR;
    this.noticeChannel = opts.noticeChannel ?? null;
  }

  get rootDir(): string {
    return this.dir;
  }

  async loadAll(): Promise<void> {
    this.unconditional.clear();
    this.conditional.clear();
    this.noticeFiredThisLoad = false;
    try {
      await this.vault.mkdir(this.dir);
    } catch {
      /* best effort */
    }
    try {
      await migrateLegacySkills({
        vault: this.vault,
        dir: this.dir,
        logger: this.logger,
        noticeChannel: this.noticeChannel,
      });
    } catch (err) {
      this.logger?.warn('skills.migrate.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    let listing: { readonly files: readonly string[]; readonly folders: readonly string[] };
    try {
      listing = await this.vault.list(this.dir);
    } catch (err) {
      this.logger?.warn('skills.load.list-failed', {
        dir: this.dir,
        error: err instanceof Error ? err.message : String(err),
      });
      this.loaded = true;
      this.changed.emit();
      return;
    }
    const seenPaths = new Set<string>();
    for (const folder of listing.folders) {
      const normalizedFolder = this.stripDirPrefix(folder);
      if (normalizedFolder.length === 0) continue;
      const canonicalName = normalizedFolder;
      const skillFilePath = `${this.dir}/${canonicalName}/${SKILL_FILE}`;
      if (seenPaths.has(skillFilePath)) continue;
      seenPaths.add(skillFilePath);
      const exists = await this.vault.exists(skillFilePath);
      if (!exists) continue;
      await this.loadOne(skillFilePath, canonicalName);
    }
    this.loaded = true;
    this.changed.emit();
  }

  private async loadOne(path: string, canonicalName: string): Promise<void> {
    let content: string;
    try {
      content = await this.vault.read(path);
    } catch (err) {
      this.reportInvalid(path, err instanceof Error ? err.message : String(err));
      return;
    }
    const parsed = parseSkillMarkdown(content, { canonicalName });
    if (!parsed.ok) {
      this.reportInvalid(path, parsed.error);
      return;
    }
    const blueprint = parsed.skill;
    if (this.unconditional.has(blueprint.name) || this.conditional.has(blueprint.name)) {
      this.logger?.warn('skills.load.duplicate', { path, name: blueprint.name });
      return;
    }
    const skillRoot = `${this.dir}/${canonicalName}`;
    const skill = buildSkill({
      blueprint,
      skillRoot,
      path,
      vault: this.vault,
    });
    const entry: SkillEntry = { skill, path, blueprint };
    if (blueprint.paths !== undefined && blueprint.paths.length > 0) {
      this.conditional.set(blueprint.name, entry);
    } else {
      this.unconditional.set(blueprint.name, entry);
    }
    this.logger?.debug('skills.load.ok', { name: blueprint.name, path });
  }

  listAvailable(): readonly Skill[] {
    const out: Skill[] = [];
    for (const { skill } of this.unconditional.values()) out.push(skill);
    for (const name of this.activatedConditional) {
      const entry = this.conditional.get(name);
      if (entry !== undefined) out.push(entry.skill);
    }
    return out;
  }

  listAll(): readonly Skill[] {
    const out: Skill[] = [];
    for (const { skill } of this.unconditional.values()) out.push(skill);
    for (const { skill } of this.conditional.values()) out.push(skill);
    return out;
  }

  find(name: string): Skill | undefined {
    return this.unconditional.get(name)?.skill ?? this.conditional.get(name)?.skill;
  }

  entry(name: string): SkillEntry | undefined {
    return this.unconditional.get(name) ?? this.conditional.get(name);
  }

  conditionalEntries(): readonly SkillEntry[] {
    return [...this.conditional.values()];
  }

  activateConditional(name: string): boolean {
    if (!this.conditional.has(name)) return false;
    if (this.activatedConditional.has(name)) return false;
    this.activatedConditional.add(name);
    this.changed.emit();
    return true;
  }

  isConditionalActivated(name: string): boolean {
    return this.activatedConditional.has(name);
  }

  clearCaches(): void {
    this.activatedConditional.clear();
    this.changed.emit();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  async writeSkill(blueprint: SkillBlueprint, raw: string): Promise<SkillEntry> {
    const canonicalName = blueprint.name;
    const folder = `${this.dir}/${canonicalName}`;
    const path = `${folder}/${SKILL_FILE}`;
    await this.vault.mkdir(folder);
    await this.vault.write(path, raw);
    const skill = buildSkill({ blueprint, skillRoot: folder, path, vault: this.vault });
    const entry: SkillEntry = { skill, path, blueprint };
    this.unconditional.delete(canonicalName);
    this.conditional.delete(canonicalName);
    if (blueprint.paths !== undefined && blueprint.paths.length > 0) {
      this.conditional.set(canonicalName, entry);
    } else {
      this.unconditional.set(canonicalName, entry);
    }
    this.changed.emit();
    return entry;
  }

  async deleteSkill(name: string): Promise<void> {
    const entry = this.unconditional.get(name) ?? this.conditional.get(name);
    if (entry === undefined) return;
    const folder = `${this.dir}/${name}`;
    const skillFile = `${folder}/${SKILL_FILE}`;
    if (await this.vault.exists(skillFile)) {
      await this.vault.remove(skillFile);
    }
    this.unconditional.delete(name);
    this.conditional.delete(name);
    this.activatedConditional.delete(name);
    this.changed.emit();
  }

  private reportInvalid(path: string, issue: string): void {
    this.logger?.warn('skills.load.invalid', { path, issue });
    if (!this.noticeFiredThisLoad && this.noticeChannel !== null) {
      this.noticeChannel.notify(`Leo: skipped invalid skill file ${path} (${issue})`);
      this.noticeFiredThisLoad = true;
    }
  }

  private stripDirPrefix(full: string): string {
    const prefix = `${this.dir}/`;
    if (full.startsWith(prefix)) return full.slice(prefix.length);
    if (full === this.dir) return '';
    return full;
  }
}

function buildSkill(args: {
  readonly blueprint: SkillBlueprint;
  readonly skillRoot: string;
  readonly path: string;
  readonly vault: VaultAdapter;
}): Skill {
  const { blueprint, skillRoot, path, vault } = args;
  const body = blueprint.body;
  return {
    type: 'prompt',
    name: blueprint.name,
    displayName: blueprint.displayName,
    description: blueprint.description,
    ...(blueprint.whenToUse !== undefined ? { whenToUse: blueprint.whenToUse } : {}),
    ...(blueprint.aliases !== undefined ? { aliases: blueprint.aliases } : {}),
    ...(blueprint.argumentHint !== undefined ? { argumentHint: blueprint.argumentHint } : {}),
    ...(blueprint.argNames !== undefined ? { argNames: blueprint.argNames } : {}),
    allowedTools: blueprint.allowedTools,
    ...(blueprint.model !== undefined ? { model: blueprint.model } : {}),
    ...(blueprint.effort !== undefined ? { effort: blueprint.effort } : {}),
    ...(blueprint.context !== undefined ? { context: blueprint.context } : {}),
    ...(blueprint.agent !== undefined ? { agent: blueprint.agent } : {}),
    ...(blueprint.hooks !== undefined ? { hooks: blueprint.hooks } : {}),
    ...(blueprint.shell !== undefined ? { shell: blueprint.shell } : {}),
    ...(blueprint.paths !== undefined ? { paths: blueprint.paths } : {}),
    disableModelInvocation: blueprint.disableModelInvocation,
    userInvocable: blueprint.userInvocable,
    source: 'userSettings',
    loadedFrom: 'skills',
    skillRoot,
    contentLength: body.length,
    isHidden: !blueprint.userInvocable,
    ...(blueprint.version !== undefined ? { version: blueprint.version } : {}),
    async getPromptForCommand(args: string, ctx: InvocationContext): Promise<InvocationResult> {
      const substituted = applySubstitutions({
        body,
        args,
        ...(blueprint.argNames !== undefined ? { argNames: blueprint.argNames } : {}),
        baseDir: skillRoot,
        ctx,
      });
      const finalContent = containsShellExpression(substituted)
        ? await evaluateShellInBody({
            body: substituted,
            ctx: {
              args,
              skillDir: skillRoot,
              ...(ctx.sessionId !== undefined ? { sessionId: ctx.sessionId } : {}),
              ...(ctx.threadId !== undefined ? { threadId: ctx.threadId } : {}),
            },
            ...(blueprint.shell !== undefined ? { spec: blueprint.shell } : {}),
          })
        : substituted;
      const messages: InvocationMessage[] = [
        {
          role: 'user',
          content: finalContent,
          marker: `<command-name>${blueprint.name}</command-name>`,
        },
      ];
      void vault; // reserved for future asset reads
      return { messages, finalContent, path };
    },
  };
}
