import { useLayoutEffect, useRef } from 'react';

export interface TemperatureSliderProps {
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
  readonly onCommit?: (value: number) => void;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 2;
const DEFAULT_STEP = 0.05;

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.min(Math.max(v, min), max);
}

export function TemperatureSlider(props: TemperatureSliderProps): JSX.Element {
  const min = props.min ?? DEFAULT_MIN;
  const max = props.max ?? DEFAULT_MAX;
  const step = props.step ?? DEFAULT_STEP;
  const value = clamp(props.value, min, max);
  const iconRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = iconRef.current;
    if (el === null) return;
    el.replaceChildren();
    if (props.setIcon !== undefined) {
      props.setIcon(el, 'thermometer');
    } else {
      el.textContent = '🌡';
    }
  }, [props.setIcon]);

  const formatted = value.toFixed(2);

  const commit = (raw: string): void => {
    const next = Number(raw);
    props.onCommit?.(clamp(next, min, max));
  };

  return (
    <span
      className="leo-header-temperature"
      data-slot="header-temperature"
      title={`Temperature: ${formatted}`}
    >
      <span ref={iconRef} className="leo-header-temperature-icon" aria-hidden="true" />
      <input
        type="range"
        className="leo-header-temperature-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={props.disabled === true}
        aria-label="Temperature"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatted}
        onChange={(e) => {
          const next = Number((e.target as HTMLInputElement).value);
          props.onChange(clamp(next, min, max));
        }}
        onPointerUp={(e) => commit((e.target as HTMLInputElement).value)}
        onKeyUp={(e) => commit((e.target as HTMLInputElement).value)}
        onBlur={(e) => commit(e.target.value)}
      />
      <span className="leo-header-temperature-value" aria-hidden="true">
        {formatted}
      </span>
    </span>
  );
}
