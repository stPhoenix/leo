// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ThinkingBlockView } from '@/ui/chat/blocks/ThinkingBlockView';

afterEach(cleanup);

describe('ThinkingBlockView (F07 AC1, AC2)', () => {
  it('expanded while streaming, body visible', () => {
    const { container } = render(
      <ThinkingBlockView block={{ type: 'thinking', thinking: 'reasoning…' }} streaming={true} />,
    );
    expect(container.querySelector('[data-expanded="true"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="thinking-body"]')?.textContent).toBe('reasoning…');
  });

  it('collapsed by default when finalised; toggle expands', () => {
    const { container } = render(
      <ThinkingBlockView
        block={{ type: 'thinking', thinking: 'final reasoning' }}
        streaming={false}
      />,
    );
    expect(container.querySelector('[data-expanded="false"]')).not.toBeNull();
    expect(container.querySelector('.leo-thinking-block.is-collapsed')).not.toBeNull();
    expect(
      container.querySelector('[data-slot="thinking-body"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    const toggle = container.querySelector('[data-slot="thinking-toggle"]') as HTMLButtonElement;
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    act(() => fireEvent.click(toggle));
    expect(container.querySelector('[data-expanded="true"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="thinking-body"]')?.textContent).toBe(
      'final reasoning',
    );
  });

  it('redacted variant shows only byte count, no toggle (AC3)', () => {
    const { container } = render(
      <ThinkingBlockView
        block={{ type: 'redacted_thinking', data: 'opaqueXX' }}
        streaming={false}
      />,
    );
    expect(container.querySelector('[data-slot="thinking-redacted"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="thinking-toggle"]')).toBeNull();
    expect(container.querySelector('[data-slot="thinking-header"]')?.textContent).toContain('8');
  });

  it('aria semantics — region role + aria-label (AC4)', () => {
    const { container } = render(
      <ThinkingBlockView block={{ type: 'thinking', thinking: 'r' }} streaming={true} />,
    );
    const region = container.querySelector('[data-slot="thinking"]');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBe('thinking');
  });
});
