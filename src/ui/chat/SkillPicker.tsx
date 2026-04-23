import { useMemo, useSyncExternalStore } from 'react';
import type { Skill } from '@/skills/types';

// Doc §1 drops the "active persona" concept, so this picker now only invokes
// skills on demand. The parent supplies `onInvoke` to route the selection
// through the slash-command processor (or Skill tool) instead of binding the
// skill to the thread.
export interface SkillPickerSource {
  readonly listSkills: () => readonly Skill[];
  readonly subscribe: (cb: () => void) => () => void;
  readonly onInvoke: (name: string) => void;
}

export interface SkillPickerProps {
  readonly source?: SkillPickerSource;
  readonly collapsed?: boolean;
}

const EMPTY: SkillPickerSource = {
  listSkills: () => [],
  subscribe: () => () => undefined,
  onInvoke: () => undefined,
};

interface PickerSnapshot {
  readonly skills: readonly Skill[];
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
  let cached: PickerSnapshot = { skills: source.listSkills() };
  return () => {
    const skills = source.listSkills();
    if (sameSkills(skills, cached.skills)) return cached;
    cached = { skills };
    return cached;
  };
}

export function SkillPicker(props: SkillPickerProps): JSX.Element {
  const source = props.source ?? EMPTY;
  const getter = useMemo(() => makeGetter(source), [source]);
  const snap = useSyncExternalStore<PickerSnapshot>(source.subscribe, getter, getter);
  const sorted = [...snap.skills].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="leo-skill-picker" data-slot="skill-picker">
      <select
        className="leo-skill-select"
        aria-label="Invoke skill"
        data-slot="skill-select"
        defaultValue=""
        onChange={(e) => {
          const value = e.target.value;
          if (value.length === 0) return;
          source.onInvoke(value);
          e.target.value = '';
        }}
      >
        <option value="" disabled>
          Invoke skill…
        </option>
        {sorted.map((s) => (
          <option key={s.name} value={s.name}>
            {s.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
