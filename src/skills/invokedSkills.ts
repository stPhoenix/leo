// Doc §13 post-compaction survival. Scope is process-lifetime (until plugin
// reload / clear) because Leo has no multi-session persistence for this yet.

import type { InvokedSkill } from '@/agent/autocompact';

export interface InvokedSkillRecord {
  readonly skillName: string;
  readonly path: string;
  readonly finalContent: string;
}

export interface InvokedSkillsStore {
  record(agentId: string, record: InvokedSkillRecord): void;
  listFor(agentId: string): readonly InvokedSkillRecord[];
  toAutocompactList(agentId: string): readonly InvokedSkill[];
  clearAgent(agentId: string): void;
  clearAll(): void;
}

export function createInvokedSkillsStore(): InvokedSkillsStore {
  const byAgent = new Map<string, Map<string, InvokedSkillRecord>>();
  return {
    record(agentId, record) {
      let perAgent = byAgent.get(agentId);
      if (perAgent === undefined) {
        perAgent = new Map();
        byAgent.set(agentId, perAgent);
      }
      perAgent.set(record.skillName, record);
    },
    listFor(agentId) {
      const perAgent = byAgent.get(agentId);
      if (perAgent === undefined) return [];
      return [...perAgent.values()];
    },
    toAutocompactList(agentId) {
      const perAgent = byAgent.get(agentId);
      if (perAgent === undefined) return [];
      const out: InvokedSkill[] = [];
      for (const record of perAgent.values()) {
        out.push({ id: record.skillName, content: record.finalContent });
      }
      return out;
    },
    clearAgent(agentId) {
      byAgent.delete(agentId);
    },
    clearAll() {
      byAgent.clear();
    },
  };
}
