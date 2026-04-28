// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { DiffView } from '@/ui/chat/blocks/DiffView';

afterEach(cleanup);

describe('DiffView (F12 AC2, AC3)', () => {
  it('identical content shows no-changes label', () => {
    const { container } = render(<DiffView before="x" after="x" />);
    expect(container.querySelector('[data-status="identical"]')?.textContent).toContain(
      'no changes',
    );
  });

  it('small diff expanded by default', () => {
    const { container } = render(<DiffView before="a\nb" after="a\nB" />);
    expect(container.querySelector('[data-slot="diff-body"]')).not.toBeNull();
    const adds = container.querySelectorAll('[data-kind="add"]');
    const dels = container.querySelectorAll('[data-kind="del"]');
    expect(adds.length).toBe(1);
    expect(dels.length).toBe(1);
  });

  it('large diff collapsed by default; toggle expands', () => {
    const before = '';
    const after = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n');
    const { container } = render(<DiffView before={before} after={after} />);
    expect(container.querySelector('.leo-diff.is-collapsed')).not.toBeNull();
    expect(container.querySelector('[data-slot="diff-body"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    const btn = container.querySelector('[data-slot="diff-toggle"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Show diff');
    act(() => fireEvent.click(btn));
    expect(container.querySelector('.leo-diff.is-expanded')).not.toBeNull();
    expect(container.querySelector('[data-slot="diff-body"]')?.getAttribute('aria-hidden')).toBe(
      'false',
    );
  });

  it('renders gutter line numbers per side', () => {
    const { container } = render(<DiffView before="a" after="a\nb" />);
    const beforeGutter = container.querySelector('[data-slot="diff-gutter-before"]');
    const afterGutter = container.querySelector('[data-slot="diff-gutter-after"]');
    expect(beforeGutter).not.toBeNull();
    expect(afterGutter).not.toBeNull();
  });
});
