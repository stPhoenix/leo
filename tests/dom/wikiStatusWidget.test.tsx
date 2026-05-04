// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WikiStatusWidget } from '@/ui/chat/widgets/WikiStatusWidget';
import type { WikiStatus } from '@/agent/wiki/wikiStatus';

afterEach(cleanup);

function makeStatus(over: Partial<WikiStatus> = {}): WikiStatus {
  return {
    indexPageCount: 12,
    indexSizeBytes: 4096,
    lastLintTimestamp: '2026-04-29T08:00:00Z',
    lastLintRunId: 'lnt-1',
    orphanPageCount: 1,
    orphanRawCount: 0,
    mutexState: { kind: 'idle' },
    ...over,
  };
}

describe('WikiStatusWidget', () => {
  it('renders all required stats from the status payload', () => {
    const { container } = render(<WikiStatusWidget props={{ status: makeStatus() }} />);
    expect(container.querySelector('[data-stat="page-count"]')?.textContent).toBe('12');
    expect(container.querySelector('[data-stat="index-size"]')?.textContent).toContain('KB');
    expect(container.querySelector('[data-stat="last-lint"]')?.textContent).toBe(
      '2026-04-29T08:00:00Z',
    );
    expect(container.querySelector('[data-stat="orphan-pages"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-stat="orphan-raw"]')?.textContent).toBe('0');
    expect(container.querySelector('[data-stat="mutex"]')?.textContent).toBe('idle');
  });

  it('renders "never" when no lint has ever run', () => {
    const { container } = render(
      <WikiStatusWidget
        props={{ status: makeStatus({ lastLintTimestamp: null, lastLintRunId: null }) }}
      />,
    );
    expect(container.querySelector('[data-stat="last-lint"]')?.textContent).toBe('never');
  });

  it('shows op + runId when mutex is busy', () => {
    const { container } = render(
      <WikiStatusWidget
        props={{
          status: makeStatus({ mutexState: { kind: 'busy', op: 'ingest', runId: 'r-1' } }),
        }}
      />,
    );
    const td = container.querySelector('[data-stat="mutex"]');
    expect(td?.textContent).toBe('ingest r-1');
    expect(container.querySelector('[data-mutex="busy"]')).not.toBeNull();
  });
});
