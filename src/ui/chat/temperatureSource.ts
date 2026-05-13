import type { SettingsStore } from '@/settings/settingsStore';

export interface TemperatureSource {
  readonly getValue: () => number;
  readonly subscribe: (cb: () => void) => () => void;
  readonly setValue: (value: number) => void;
}

const MIN = 0;
const MAX = 2;

function clamp(v: number): number {
  if (Number.isNaN(v)) return MIN;
  return Math.min(Math.max(v, MIN), MAX);
}

export function makeTemperatureSource(store: SettingsStore): TemperatureSource {
  return {
    getValue: () => store.get().provider.temperature,
    subscribe: (cb) => store.on(() => cb()),
    setValue: (value) => {
      const next = clamp(value);
      const prev = store.get().provider.temperature;
      if (next === prev) return;
      void store.update((s) => ({
        ...s,
        provider: { ...s.provider, temperature: next },
      }));
    },
  };
}
