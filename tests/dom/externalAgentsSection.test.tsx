// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  ExternalAgentAdapter,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';
import { ExternalAgentsSection } from '@/settings/ExternalAgentsSection';
import type { ExternalAgentsSettings } from '@/settings/settingsStore';

afterEach(cleanup);

class MockA extends ExternalAgentAdapter {
  readonly id = 'mock-a';
  readonly label = 'Mock A';
  readonly defaultTimeoutMs = 1000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({
    binaryPath: z.string(),
    debug: z.boolean(),
  });
  start(_i: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ value: undefined as unknown as ExternalEvent, done: true }),
      }),
    };
  }
}

class MockB extends ExternalAgentAdapter {
  readonly id = 'mock-b';
  readonly label = 'Mock B';
  readonly defaultTimeoutMs = 1000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({ apiKey: z.string().describe('secret') });
  start(_i: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ value: undefined as unknown as ExternalEvent, done: true }),
      }),
    };
  }
}

function makeRegistry(adapters: ExternalAgentAdapter[]): AdapterRegistry {
  const r = new AdapterRegistry({
    enabledSource: () => Object.fromEntries(adapters.map((a) => [a.id, true])),
  });
  for (const a of adapters) r.register(a);
  return r;
}

function Harness(props: {
  registry: AdapterRegistry;
  initial: ExternalAgentsSettings;
  onChange?: (next: ExternalAgentsSettings) => void;
}) {
  const [s, setS] = useState(props.initial);
  return (
    <ExternalAgentsSection
      registry={props.registry}
      settings={s}
      onChange={(next) => {
        setS(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe('ExternalAgentsSection', () => {
  it('renders empty-state note when no adapters registered', () => {
    const { container } = render(
      <Harness registry={makeRegistry([])} initial={{ defaultAdapterId: null, adapters: {} }} />,
    );
    expect(container.querySelector('[data-slot="external-agents-empty"]')?.textContent).toContain(
      'No external-agent adapters',
    );
  });

  it('lists registered adapters with enable toggle', () => {
    const r = makeRegistry([new MockA()]);
    const { container, getByLabelText } = render(
      <Harness
        registry={r}
        initial={{
          defaultAdapterId: 'mock-a',
          adapters: { 'mock-a': { enabled: true, config: {} } },
        }}
      />,
    );
    expect(container.querySelector('[data-adapter-id="mock-a"]')).not.toBeNull();
    const toggle = getByLabelText('Enable Mock A') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('toggle disables adapter (state propagates via onChange)', () => {
    const r = makeRegistry([new MockA(), new MockB()]);
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <Harness
        registry={r}
        initial={{
          defaultAdapterId: 'mock-a',
          adapters: {
            'mock-a': { enabled: true, config: {} },
            'mock-b': { enabled: true, config: {} },
          },
        }}
        onChange={onChange}
      />,
    );
    const toggle = getByLabelText('Enable Mock A') as HTMLInputElement;
    act(() => fireEvent.click(toggle));
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as ExternalAgentsSettings;
    expect(last.adapters['mock-a']?.enabled).toBe(false);
  });

  it('default-adapter dropdown updates settings', () => {
    const r = makeRegistry([new MockA(), new MockB()]);
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <Harness
        registry={r}
        initial={{
          defaultAdapterId: 'mock-a',
          adapters: {
            'mock-a': { enabled: true, config: {} },
            'mock-b': { enabled: true, config: {} },
          },
        }}
        onChange={onChange}
      />,
    );
    const select = getByLabelText('Default external adapter') as HTMLSelectElement;
    act(() => fireEvent.change(select, { target: { value: 'mock-b' } }));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]![0] as ExternalAgentsSettings;
    expect(last.defaultAdapterId).toBe('mock-b');
  });

  it('renders secret field as password input with reveal toggle', () => {
    const r = makeRegistry([new MockB()]);
    const { container, getByLabelText } = render(
      <Harness
        registry={r}
        initial={{
          defaultAdapterId: 'mock-b',
          adapters: { 'mock-b': { enabled: true, config: {} } },
        }}
      />,
    );
    const secretEl = container.querySelector(
      '[data-slot="external-agents-secret"] input',
    ) as HTMLInputElement;
    expect(secretEl.type).toBe('password');
    const toggle = getByLabelText('Toggle reveal for apiKey');
    act(() => fireEvent.click(toggle));
    const after = container.querySelector(
      '[data-slot="external-agents-secret"] input',
    ) as HTMLInputElement;
    expect(after.type).toBe('text');
  });

  it('shows warning when configured default is disabled', () => {
    const r = makeRegistry([new MockA(), new MockB()]);
    const { container } = render(
      <Harness
        registry={r}
        initial={{
          defaultAdapterId: 'mock-a',
          adapters: {
            'mock-a': { enabled: false, config: {} },
            'mock-b': { enabled: true, config: {} },
          },
        }}
      />,
    );
    expect(
      container.querySelector('[data-slot="external-agents-default-disabled"]'),
    ).not.toBeNull();
  });
});
