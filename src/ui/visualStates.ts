export type VisualState =
  | 'idle'
  | 'streaming'
  | 'tool-running'
  | 'awaiting-confirmation'
  | 'error'
  | 'cancelled'
  | 'edit-locked';

export const VISUAL_STATES: readonly VisualState[] = [
  'idle',
  'streaming',
  'tool-running',
  'awaiting-confirmation',
  'error',
  'cancelled',
  'edit-locked',
];

export interface VisualStateAriaHint {
  readonly role?: 'status' | 'alert';
  readonly ariaBusy?: boolean;
  readonly ariaLive?: 'polite' | 'assertive' | 'off';
}

const ARIA: Record<VisualState, VisualStateAriaHint> = {
  idle: {},
  streaming: { role: 'status', ariaLive: 'polite', ariaBusy: true },
  'tool-running': { role: 'status', ariaLive: 'polite', ariaBusy: true },
  'awaiting-confirmation': { role: 'status', ariaLive: 'assertive', ariaBusy: true },
  error: { role: 'alert', ariaLive: 'assertive' },
  cancelled: { role: 'status', ariaLive: 'polite' },
  'edit-locked': { role: 'status', ariaLive: 'polite', ariaBusy: true },
};

export function ariaHintFor(state: VisualState): VisualStateAriaHint {
  return ARIA[state];
}

export function applyVisualState(el: HTMLElement, state: VisualState): void {
  el.setAttribute('data-visual-state', state);
  const hint = ARIA[state];
  if (hint.role !== undefined) {
    el.setAttribute('role', hint.role);
  } else {
    el.removeAttribute('role');
  }
  if (hint.ariaLive !== undefined) {
    el.setAttribute('aria-live', hint.ariaLive);
  } else {
    el.removeAttribute('aria-live');
  }
  if (hint.ariaBusy === true) {
    el.setAttribute('aria-busy', 'true');
  } else {
    el.removeAttribute('aria-busy');
  }
}
