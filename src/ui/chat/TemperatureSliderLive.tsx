import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TemperatureSlider } from './TemperatureSlider';
import { debounce } from '@/util/debounce';
import type { TemperatureSource } from './temperatureSource';

export interface TemperatureSliderLiveProps {
  readonly source: TemperatureSource;
  readonly debounceMs?: number;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

// Temperature changes during an in-flight turn are NOT applied to the running
// stream — the provider model was already constructed with the prior value.
// The next turn picks up the new value via SettingsStore.
export function TemperatureSliderLive(props: TemperatureSliderLiveProps): JSX.Element {
  const external = useSyncExternalStore<number>(
    props.source.subscribe,
    props.source.getValue,
    props.source.getValue,
  );

  const [local, setLocal] = useState<number>(external);
  const draggingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!draggingRef.current) setLocal(external);
  }, [external]);

  const waitMs = props.debounceMs ?? 200;
  const debounced = useMemo(
    () => debounce<[number]>((v) => props.source.setValue(v), waitMs),
    [props.source, waitMs],
  );

  useEffect(
    () => () => {
      debounced.flush();
    },
    [debounced],
  );

  return (
    <TemperatureSlider
      value={local}
      onChange={(v) => {
        draggingRef.current = true;
        setLocal(v);
        debounced(v);
      }}
      onCommit={(v) => {
        draggingRef.current = false;
        debounced(v);
        debounced.flush();
      }}
      {...(props.setIcon !== undefined ? { setIcon: props.setIcon } : {})}
    />
  );
}
