// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TemperatureSlider } from '@/ui/chat/TemperatureSlider';
import { TemperatureSliderLive } from '@/ui/chat/TemperatureSliderLive';
import type { TemperatureSource } from '@/ui/chat/temperatureSource';

afterEach(cleanup);

function makeMockSource(initial: number): {
  source: TemperatureSource;
  emit: (next: number) => void;
  calls: number[];
} {
  let value = initial;
  const listeners = new Set<() => void>();
  const calls: number[] = [];
  const source: TemperatureSource = {
    getValue: () => value,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    setValue: (v) => {
      calls.push(v);
      value = v;
      for (const l of listeners) l();
    },
  };
  return {
    source,
    emit: (next) => {
      value = next;
      for (const l of listeners) l();
    },
    calls,
  };
}

describe('TemperatureSlider', () => {
  it('renders with ARIA: role=slider, min/max/now, formatted text', () => {
    render(<TemperatureSlider value={0.7} onChange={() => {}} />);
    const slider = screen.getByRole('slider', { name: 'Temperature' });
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('2');
    expect(slider.getAttribute('aria-valuenow')).toBe('0.7');
    expect(slider.getAttribute('aria-valuetext')).toBe('0.70');
    expect(screen.getByText('0.70')).toBeTruthy();
  });

  it('fires onChange on change event with clamped numeric value', () => {
    const calls: number[] = [];
    render(<TemperatureSlider value={0.7} onChange={(v) => calls.push(v)} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.25' } });
    expect(calls).toEqual([1.25]);
  });

  it('fires onCommit on pointer up', () => {
    const commits: number[] = [];
    const { container } = render(
      <TemperatureSlider value={0.7} onChange={() => {}} onCommit={(v) => commits.push(v)} />,
    );
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '1.5';
    fireEvent.pointerUp(slider);
    expect(commits).toEqual([1.5]);
  });

  it('fires onCommit on key up', () => {
    const commits: number[] = [];
    const { container } = render(
      <TemperatureSlider value={0.7} onChange={() => {}} onCommit={(v) => commits.push(v)} />,
    );
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    slider.value = '1.1';
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(commits).toEqual([1.1]);
  });

  it('clamps values above max', () => {
    const calls: number[] = [];
    render(<TemperatureSlider value={5} onChange={(v) => calls.push(v)} />);
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuenow')).toBe('2');
  });

  it('respects disabled prop', () => {
    render(<TemperatureSlider value={0.7} disabled onChange={() => {}} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
  });

  it('renders icon fallback text when no setIcon provided', () => {
    const { container } = render(<TemperatureSlider value={0.7} onChange={() => {}} />);
    const icon = container.querySelector('.leo-header-temperature-icon');
    expect(icon).toBeTruthy();
    expect(icon?.textContent).toBe('🌡');
  });

  it('uses setIcon callback when provided', () => {
    const setIcon = vi.fn((el: HTMLElement, name: string) => {
      el.textContent = `[icon:${name}]`;
    });
    render(<TemperatureSlider value={0.7} onChange={() => {}} setIcon={setIcon} />);
    expect(setIcon).toHaveBeenCalledWith(expect.any(HTMLElement), 'thermometer');
  });
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TemperatureSliderLive', () => {
  it('renders the external value', () => {
    const { source } = makeMockSource(0.5);
    render(<TemperatureSliderLive source={source} />);
    expect(screen.getByText('0.50')).toBeTruthy();
  });

  it('debounces change events to a single setValue call', async () => {
    const { source, calls } = makeMockSource(0.5);
    render(<TemperatureSliderLive source={source} debounceMs={50} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    act(() => {
      fireEvent.change(slider, { target: { value: '0.6' } });
      fireEvent.change(slider, { target: { value: '0.7' } });
      fireEvent.change(slider, { target: { value: '0.8' } });
    });
    expect(calls).toEqual([]);
    await wait(120);
    expect(calls).toEqual([0.8]);
  });

  it('flushes pending debounced value on pointer up', () => {
    const { source, calls } = makeMockSource(0.5);
    const { container } = render(<TemperatureSliderLive source={source} debounceMs={200} />);
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(slider, { target: { value: '1.2' } });
      fireEvent.pointerUp(slider);
    });
    expect(calls).toEqual([1.2]);
  });

  it('reflects external updates when not dragging', () => {
    const { source, emit } = makeMockSource(0.5);
    render(<TemperatureSliderLive source={source} />);
    act(() => {
      emit(1.4);
    });
    expect(screen.getByText('1.40')).toBeTruthy();
  });

  it('flushes pending value on unmount', () => {
    const { source, calls } = makeMockSource(0.5);
    const { unmount } = render(<TemperatureSliderLive source={source} debounceMs={500} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    act(() => {
      fireEvent.change(slider, { target: { value: '1.7' } });
    });
    expect(calls).toEqual([]);
    unmount();
    expect(calls).toEqual([1.7]);
  });
});
