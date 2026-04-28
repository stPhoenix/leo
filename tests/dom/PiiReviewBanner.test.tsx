// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, act } from '@testing-library/react';
import { PiiReviewBanner } from '@/ui/chat/blocks/PiiReviewBanner';
import type { PiiDecision } from '@/agent/externalAgent/applyPiiDecisions';
import type { PiiFinding } from '@/agent/externalAgent/piiDetectAgent';

afterEach(cleanup);

const findings: readonly PiiFinding[] = [
  { id: 'a', kind: 'email', start: 0, end: 10, sample: 'a*@x.com', suggestion: 'mask' },
  { id: 'b', kind: 'apiKey', start: 11, end: 20, sample: 'A***E', suggestion: 'remove' },
];

function noop(): void {}

describe('PiiReviewBanner', () => {
  it('returns null on idle', () => {
    const { container } = render(
      <PiiReviewBanner
        status="idle"
        findings={[]}
        decisions={new Map()}
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    expect(container.querySelector('[data-slot="pii-review"]')).toBeNull();
  });

  it('returns null on ready with no findings', () => {
    const { container } = render(
      <PiiReviewBanner
        status="ready"
        findings={[]}
        decisions={new Map()}
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    expect(container.querySelector('[data-slot="pii-review"]')).toBeNull();
  });

  it('shows scanning indicator on scanning status', () => {
    const { container } = render(
      <PiiReviewBanner
        status="scanning"
        findings={[]}
        decisions={new Map()}
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    expect(container.querySelector('[data-slot="pii-scanning"]')).not.toBeNull();
    expect(container.textContent).toContain('Checking for sensitive content');
  });

  it('shows error message and Retry button on error status', () => {
    const onRetry = vi.fn();
    const { container, getByLabelText } = render(
      <PiiReviewBanner
        status="error"
        findings={[]}
        decisions={new Map()}
        errorMessage="provider down"
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
        onRetry={onRetry}
      />,
    );
    expect(container.textContent).toContain('Detection failed');
    expect(container.textContent).toContain('provider down');
    const btn = getByLabelText('Retry PII detection');
    act(() => fireEvent.click(btn));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders one row per finding with kind label and sample', () => {
    const { container } = render(
      <PiiReviewBanner
        status="ready"
        findings={findings}
        decisions={new Map()}
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    const rows = container.querySelectorAll('[data-slot="pii-finding"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Email');
    expect(rows[0]?.textContent).toContain('a*@x.com');
    expect(rows[1]?.textContent).toContain('API key');
    expect(rows[1]?.textContent).toContain('A***E');
  });

  it('aria-pressed reflects decision and clicks call onDecide', () => {
    const onDecide = vi.fn();
    const { container } = render(
      <PiiReviewBanner
        status="ready"
        findings={findings}
        decisions={new Map<string, PiiDecision>([['a', 'mask']])}
        onDecide={onDecide}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    const rowA = container.querySelectorAll('[data-slot="pii-finding"]')[0];
    expect(
      rowA?.querySelector('[aria-label="Mask this finding"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      rowA?.querySelector('[aria-label="Remove this finding"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
    const removeBtn = rowA?.querySelector('[aria-label="Remove this finding"]');
    act(() => fireEvent.click(removeBtn as HTMLElement));
    expect(onDecide).toHaveBeenCalledWith('a', 'remove');
  });

  it('header pendingCount reflects ignore decisions', () => {
    const { container } = render(
      <PiiReviewBanner
        status="ready"
        findings={findings}
        decisions={new Map<string, PiiDecision>([['a', 'ignore']])}
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    expect(container.textContent).toContain('1 pending of 2');
  });

  it('disables footer buttons when pendingCount === 0', () => {
    const decisions = new Map<string, PiiDecision>([
      ['a', 'ignore'],
      ['b', 'ignore'],
    ]);
    const { getByLabelText } = render(
      <PiiReviewBanner
        status="ready"
        findings={findings}
        decisions={decisions}
        onDecide={noop}
        onApplyAll={noop}
        onIgnoreAll={noop}
      />,
    );
    expect(
      (getByLabelText('Apply suggested decisions to all findings') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((getByLabelText('Ignore all findings') as HTMLButtonElement).disabled).toBe(true);
  });

  it('footer buttons fire bulk callbacks', () => {
    const onApplyAll = vi.fn();
    const onIgnoreAll = vi.fn();
    const { getByLabelText } = render(
      <PiiReviewBanner
        status="ready"
        findings={findings}
        decisions={new Map()}
        onDecide={noop}
        onApplyAll={onApplyAll}
        onIgnoreAll={onIgnoreAll}
      />,
    );
    act(() => fireEvent.click(getByLabelText('Apply suggested decisions to all findings')));
    expect(onApplyAll).toHaveBeenCalledTimes(1);
    act(() => fireEvent.click(getByLabelText('Ignore all findings')));
    expect(onIgnoreAll).toHaveBeenCalledTimes(1);
  });
});
