// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ExternalAgentTerminalBlock } from '@/ui/chat/blocks/ExternalAgentTerminalBlock';
import type { ExternalAgentTerminalSnapshot } from '@/agent/externalAgent/terminalSnapshot';

afterEach(cleanup);

const baseSnapshot = (
  overrides: Partial<ExternalAgentTerminalSnapshot> = {},
): ExternalAgentTerminalSnapshot => ({
  runId: 'r1',
  threadId: 't1',
  adapterId: 'mock',
  adapterLabel: 'Mock',
  terminalPhase: 'done',
  folder: 'externalAgentResults/r1',
  files: ['request.md', 'response.md'],
  durationMs: 5_000,
  refinedPrompt: 'final',
  refineTranscript: [
    { role: 'user', content: 'asked' },
    { role: 'assistant', content: 'final' },
  ],
  responseText: 'response body',
  logCount: 3,
  error: null,
  adapterConfigSnapshot: { model: 'sonar' },
  schemaVersion: 1,
  ...overrides,
});

describe('ExternalAgentTerminalBlock', () => {
  it('renders nothing for malformed payload', () => {
    const { container } = render(<ExternalAgentTerminalBlock props={{ totally: 'wrong' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders done summary with folder and duration', () => {
    const { container } = render(<ExternalAgentTerminalBlock props={baseSnapshot()} />);
    expect(container.querySelector('[data-phase="done"]')).not.toBeNull();
    expect(container.textContent).toContain('externalAgentResults/r1');
    expect(container.textContent).toContain('5s');
  });

  it('expand toggles refine transcript + response', () => {
    const { container, getByLabelText } = render(
      <ExternalAgentTerminalBlock props={baseSnapshot()} />,
    );
    expect(container.querySelector('.leo-ea-terminal.is-collapsed')).not.toBeNull();
    expect(
      container.querySelector('[data-slot="external-agent-expanded"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    act(() => fireEvent.click(getByLabelText('External agent run done — toggle details')));
    expect(container.querySelector('.leo-ea-terminal.is-collapsed')).toBeNull();
    expect(
      container.querySelector('[data-slot="external-agent-expanded"]')?.getAttribute('aria-hidden'),
    ).toBe('false');
    expect(container.textContent).toContain('response body');
    expect(container.textContent).toContain('asked');
  });

  it('reload variant renders distinct copy', () => {
    const { container } = render(
      <ExternalAgentTerminalBlock
        props={baseSnapshot({
          terminalPhase: 'error',
          error: { code: 'reload', message: 'Plugin reloaded during run' },
        })}
      />,
    );
    expect(container.querySelector('[data-slot="external-agent-reload"]')).not.toBeNull();
  });

  it('error variant shows error block on expand', () => {
    const { container, getByLabelText } = render(
      <ExternalAgentTerminalBlock
        props={baseSnapshot({
          terminalPhase: 'error',
          error: { code: 'timeout', message: 'too long' },
        })}
      />,
    );
    act(() => fireEvent.click(getByLabelText('External agent run error — toggle details')));
    expect(container.textContent).toContain('[timeout]');
    expect(container.textContent).toContain('too long');
  });
});
