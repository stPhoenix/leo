// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { VISUAL_STATES, applyVisualState, ariaHintFor } from '@/ui/visualStates';

describe('VisualState union and attribute application', () => {
  it('exposes exactly the seven states specified by FR-UI-06', () => {
    expect(VISUAL_STATES).toEqual([
      'idle',
      'streaming',
      'tool-running',
      'awaiting-confirmation',
      'error',
      'cancelled',
      'edit-locked',
    ]);
  });

  it('applies a stable data-visual-state attribute', () => {
    const el = document.createElement('div');
    applyVisualState(el, 'streaming');
    expect(el.getAttribute('data-visual-state')).toBe('streaming');
    applyVisualState(el, 'awaiting-confirmation');
    expect(el.getAttribute('data-visual-state')).toBe('awaiting-confirmation');
  });

  it('sets ARIA role / aria-live / aria-busy per state, and clears them on idle', () => {
    const el = document.createElement('div');
    applyVisualState(el, 'streaming');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(el.getAttribute('aria-busy')).toBe('true');
    applyVisualState(el, 'error');
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    expect(el.getAttribute('aria-busy')).toBeNull();
    applyVisualState(el, 'idle');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('aria-live')).toBeNull();
    expect(el.getAttribute('aria-busy')).toBeNull();
  });

  it('returns aria hints consistent with applyVisualState', () => {
    expect(ariaHintFor('awaiting-confirmation')).toEqual({
      role: 'status',
      ariaLive: 'assertive',
      ariaBusy: true,
    });
    expect(ariaHintFor('cancelled')).toEqual({
      role: 'status',
      ariaLive: 'polite',
    });
  });
});
