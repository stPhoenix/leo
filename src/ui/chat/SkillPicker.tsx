import { useMemo, useSyncExternalStore } from 'react';
import type { Skill } from '@/skills/types';

export interface SkillPickerSource {
  readonly listSkills: () => readonly Skill[];
  readonly currentSkillId: () => string;
  readonly subscribe: (cb: () => void) => () => void;
  readonly select: (id: string) => void;
}

export interface SkillPickerProps {
  readonly source?: SkillPickerSource;
  readonly collapsed?: boolean;
}

const EMPTY: SkillPickerSource = {
  listSkills: () => [],
  currentSkillId: () => 'general',
  subscribe: () => () => undefined,
  select: () => undefined,
};

interface PickerSnapshot {
  readonly skills: readonly Skill[];
  readonly activeId: string;
}

function sameSkills(a: readonly Skill[], b: readonly Skill[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function makeGetter(source: SkillPickerSource): () => PickerSnapshot {
  let cached: PickerSnapshot = { skills: source.listSkills(), activeId: source.currentSkillId() };
  return () => {
    const skills = source.listSkills();
    const activeId = source.currentSkillId();
    if (activeId === cached.activeId && sameSkills(skills, cached.skills)) return cached;
    cached = { skills, activeId };
    return cached;
  };
}

export function SkillPicker(props: SkillPickerProps): JSX.Element {
  const source = props.source ?? EMPTY;
  const getter = useMemo(() => makeGetter(source), [source]);
  const snap = useSyncExternalStore<PickerSnapshot>(source.subscribe, getter, getter);
  const active = snap.skills.find((s) => s.id === snap.activeId);
  const displayName = active?.name ?? 'General';
  const sorted = [...snap.skills].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="leo-skill-picker" data-slot="skill-picker">
      <span
        className="leo-skill-badge"
        role="status"
        aria-label={`Active skill: ${displayName}`}
        data-slot="skill-badge"
      >
        {displayName}
      </span>
      <select
        className="leo-skill-select"
        aria-label="Select skill"
        data-slot="skill-select"
        value={snap.activeId}
        onChange={(e) => source.select(e.target.value)}
      >
        {sorted.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}
