import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { z } from 'zod';
import { useState } from 'react';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  ExternalAgentAdapter,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';
import { OpenfangAdapter } from '@/agent/externalAgent/adapters/openfang';
import { ExternalAgentsSection } from './ExternalAgentsSection';
import type { ExternalAgentsSettings } from './settingsStore';

const emptyEventStream = (_input: ExternalAgentInput): AsyncIterable<ExternalEvent> => ({
  [Symbol.asyncIterator]: () => ({
    next: async () => ({ value: undefined as unknown as ExternalEvent, done: true }),
  }),
});

class MockAdapterA extends ExternalAgentAdapter {
  readonly id = 'mock-a';
  readonly label = 'Mock A (CLI)';
  readonly defaultTimeoutMs = 60_000;
  readonly capabilities = { files: true, stream: true } as const;
  readonly configSchema = z.object({
    binaryPath: z.string().describe('Path to binary'),
    extraArgs: z.array(z.string()).describe('Extra command-line args'),
    debug: z.boolean(),
  });
  start = emptyEventStream;
}

class MockAdapterB extends ExternalAgentAdapter {
  readonly id = 'mock-b';
  readonly label = 'Mock B (HTTP)';
  readonly defaultTimeoutMs = 30_000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({
    baseUrl: z.string().describe('Endpoint base URL'),
    model: z.string(),
    apiKey: z.string().describe('secret'),
  });
  start = emptyEventStream;
}

function makeRegistry(adapters: ExternalAgentAdapter[]): AdapterRegistry {
  const r = new AdapterRegistry({
    enabledSource: () => Object.fromEntries(adapters.map((a) => [a.id, true])),
    defaultIdSource: () => adapters[0]?.id ?? null,
  });
  for (const a of adapters) r.register(a);
  return r;
}

function StoryShell(props: {
  registry: AdapterRegistry;
  initialSettings: ExternalAgentsSettings;
}): JSX.Element {
  const [settings, setSettings] = useState(props.initialSettings);
  return (
    <ExternalAgentsSection
      registry={props.registry}
      settings={settings}
      onChange={setSettings}
      readSecret={async () => ''}
      writeSecret={async () => undefined}
    />
  );
}

const meta: Meta<typeof StoryShell> = {
  title: 'Settings/ExternalAgentsSection',
  component: StoryShell,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof StoryShell>;

export const Default: Story = {
  args: {
    registry: makeRegistry([new MockAdapterA(), new MockAdapterB()]),
    initialSettings: {
      defaultAdapterId: 'mock-a',
      adapters: {
        'mock-a': {
          enabled: true,
          config: { binaryPath: 'mock', extraArgs: [], debug: false },
        },
        'mock-b': {
          enabled: true,
          config: { baseUrl: 'https://api.example.com', model: 'gpt-x', apiKey: '' },
        },
      },
    },
  },
};

export const WithSecretsHidden: Story = {
  args: {
    registry: makeRegistry([new MockAdapterB()]),
    initialSettings: {
      defaultAdapterId: 'mock-b',
      adapters: {
        'mock-b': {
          enabled: true,
          config: {
            baseUrl: 'https://api.example.com',
            model: 'gpt-x',
            apiKey: 'safeStorage:externalAgents.mock-b.apiKey',
          },
        },
      },
    },
  },
};

export const DefaultAdapterDisabled: Story = {
  args: {
    registry: makeRegistry([new MockAdapterA(), new MockAdapterB()]),
    initialSettings: {
      defaultAdapterId: 'mock-a',
      adapters: {
        'mock-a': { enabled: false, config: {} },
        'mock-b': { enabled: true, config: {} },
      },
    },
  },
};

export const NoAdaptersRegistered: Story = {
  args: {
    registry: makeRegistry([]),
    initialSettings: {
      defaultAdapterId: null,
      adapters: {},
    },
  },
};

const OPENFANG_CONFIG = {
  baseUrl: 'https://openfang.example.com:4200',
  apiKey: 'demo-key-redacted',
  sessionId: 'leo-thread-001',
  pollTimeoutMs: 1_800_000,
  pollInitialIntervalMs: 2_000,
  pollMaxIntervalMs: 15_000,
  httpTimeoutMs: 30_000,
  allowInsecureHttp: false,
};

export const OpenfangConfigured: Story = {
  args: {
    registry: makeRegistry([new OpenfangAdapter()]),
    initialSettings: {
      defaultAdapterId: 'openfang',
      adapters: {
        openfang: { enabled: true, config: OPENFANG_CONFIG },
      },
    },
  },
};

export const OpenfangSecretRevealed: Story = {
  args: {
    registry: makeRegistry([new OpenfangAdapter()]),
    initialSettings: {
      defaultAdapterId: 'openfang',
      adapters: {
        openfang: { enabled: true, config: OPENFANG_CONFIG },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const reveal = await c.findByRole('button', { name: /toggle reveal for apikey/i });
    await userEvent.click(reveal);
  },
};

export const OpenfangDisabled: Story = {
  args: {
    registry: makeRegistry([new OpenfangAdapter()]),
    initialSettings: {
      defaultAdapterId: 'openfang',
      adapters: {
        openfang: { enabled: false, config: OPENFANG_CONFIG },
      },
    },
  },
};

export const OpenfangInvalidBaseUrl: Story = {
  args: {
    registry: makeRegistry([new OpenfangAdapter()]),
    initialSettings: {
      defaultAdapterId: 'openfang',
      adapters: {
        openfang: {
          enabled: true,
          config: { ...OPENFANG_CONFIG, baseUrl: 'not-a-url' },
        },
      },
    },
  },
};
