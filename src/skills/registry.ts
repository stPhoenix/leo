// Doc §4/§8/§10 registry. Central read-only view over the loader(s). Holds
// per-agent "already sent" tracking for the turn-0 listing and records which
// conditional skills have been activated so they survive cache clears.

import type { Logger } from '@/platform/Logger';
import { createConditionalMatcher } from './conditional';
import { DynamicDiscovery } from './dynamic';
import { createSignal, type Signal } from './signals';
import type { SkillEntry, SkillsStore } from './skillsStore';
import type { Skill } from './types';

export interface SkillRegistryOptions {
  readonly store: SkillsStore;
  readonly logger?: Logger;
  readonly cwd?: string;
}

export const MAIN_AGENT_ID = '';

export class SkillRegistry {
  private readonly store: SkillsStore;
  private readonly logger: Logger | undefined;
  private readonly sentByAgent = new Map<string, Set<string>>();
  private readonly dynamic: DynamicDiscovery;
  readonly changed: Signal<void> = createSignal<void>();

  constructor(opts: SkillRegistryOptions) {
    this.store = opts.store;
    this.logger = opts.logger;
    this.dynamic = new DynamicDiscovery({
      cwd: opts.cwd ?? '',
      skillsSubdir: `${opts.store.rootDir}`,
      exists: async () => false,
    });
    opts.store.changed.subscribe(() => this.changed.emit());
  }

  availableSkills(): readonly Skill[] {
    return this.store.listAvailable();
  }

  findSkill(name: string): Skill | undefined {
    return this.store.find(name);
  }

  entry(name: string): SkillEntry | undefined {
    return this.store.entry(name);
  }

  sentNamesFor(agentId: string): ReadonlySet<string> {
    return this.sentByAgent.get(agentId) ?? new Set();
  }

  markSent(agentId: string, names: readonly string[]): void {
    let set = this.sentByAgent.get(agentId);
    if (set === undefined) {
      set = new Set();
      this.sentByAgent.set(agentId, set);
    }
    for (const name of names) set.add(name);
  }

  clearSent(agentId?: string): void {
    if (agentId === undefined) {
      this.sentByAgent.clear();
      return;
    }
    this.sentByAgent.delete(agentId);
  }

  onFileTouch(relativePath: string): void {
    const activated: string[] = [];
    for (const entry of this.store.conditionalEntries()) {
      if (entry.blueprint.paths === undefined) continue;
      if (this.store.isConditionalActivated(entry.blueprint.name)) continue;
      const matcher = createConditionalMatcher(entry.blueprint.paths);
      if (matcher === null) continue;
      if (matcher.matches(relativePath)) {
        if (this.store.activateConditional(entry.blueprint.name)) {
          activated.push(entry.blueprint.name);
        }
      }
    }
    if (activated.length > 0) {
      this.logger?.info('skills.conditional.activated', { names: activated });
    }
    // Dynamic skill-dir discovery: fire-and-forget so callers on the file-op
    // path stay synchronous.
    void this.dynamic.observeFileTouch(relativePath).then((result) => {
      if (result.newRoots.length === 0) return;
      this.logger?.debug('skills.dynamic.found', { roots: result.newRoots });
    });
  }
}
