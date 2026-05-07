import type { Meta, StoryObj } from '@storybook/react-vite';
import { CanvasWidget } from './CanvasWidget';
import { CanvasWidgetController } from '@/agent/canvas/widget/widgetController';
import type { CanvasOp } from '@/agent/canvas/mutex';
import type { CanvasViewModel } from '@/agent/canvas/widget/widgetState';
import type { CanvasPaletteId } from '@/agent/canvas/layouts/colorPalette';

function ctrl(op: CanvasOp, patch: Partial<CanvasViewModel>): CanvasWidgetController {
  const c = new CanvasWidgetController({
    runId: '20260505-120000-abc123',
    threadId: 't1',
    op,
    targetPath: 'canvases/example.canvas',
    originalAsk: 'Build a canvas of org structure from team-page.md',
  });
  c.update(patch);
  return c;
}

const meta: Meta<typeof CanvasWidget> = {
  title: 'Chat/Blocks/CanvasWidget',
  component: CanvasWidget,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CanvasWidget>;

function awaitingConfigStory(paletteId: CanvasPaletteId): Story {
  return {
    args: {
      controller: ctrl('create', {
        phase: 'awaiting_config',
        config: {
          providers: ['lmstudio', 'openai', 'anthropic'],
          draftProviderId: 'lmstudio',
          draftModel: 'qwen3',
          draftPreset: 'auto',
          draftPath: 'canvases/example.canvas',
          draftPaletteId: paletteId,
          models: { state: 'ok', items: [{ id: 'qwen3' }, { id: 'llama3' }] },
          defaultProviderId: 'lmstudio',
          defaultModel: 'qwen3',
          defaultPreset: 'auto',
          defaultPath: 'canvases/example.canvas',
          defaultPaletteId: paletteId,
          apiKeyMissing: false,
          validationError: null,
          originalAsk: 'Build a canvas of org structure from team-page.md',
        },
      }),
    },
  };
}

export const AwaitingConfigIdle: Story = awaitingConfigStory('coolVivid');
export const AwaitingConfigForestSteel: Story = awaitingConfigStory('forestSteel');
export const AwaitingConfigPastelPlate: Story = awaitingConfigStory('pastelPlate');
export const AwaitingConfigRainbow: Story = awaitingConfigStory('rainbow');
export const AwaitingConfigMonoOcean: Story = awaitingConfigStory('monoOcean');
export const AwaitingConfigSunset: Story = awaitingConfigStory('sunset');

export const PreparingRefining: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'preparing',
      refineTranscript: [{ role: 'assistant', content: 'Working on plan…' }],
    }),
  },
};

export const PreparingClarifying: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'preparing',
      refineTranscript: [{ role: 'assistant', content: 'Need clarification.' }],
      clarifyingQuestion: 'Which entity types should be included?',
    }),
  },
};

export const FetchingProgress: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'fetching',
      fetchProgress: { total: 4, completed: 2, current: 'team-page.md' },
    }),
  },
};

export const ExtractingProgress: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'extracting',
      extractProgress: { total: 4, completed: 3, failed: 1 },
    }),
  },
};

export const ReducingInsights: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'reducing',
      insights: {
        hubs: [{ id: 'e1', name: 'Alice', degree: 5 }],
        components: { count: 2, sizes: [8, 3] },
        orphans: [],
        perTypeCount: { person: 5, team: 2 },
      },
    }),
  },
};

export const DiffingSummary: Story = {
  args: {
    controller: ctrl('content_edit', {
      phase: 'diffing',
      diffSummary: { kept: 5, added: 3, removed: 2, locked: 1 },
      tombstoneSummary: '2 items removed in prior runs.',
    }),
  },
};

export const LayingOutProgress: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'laying_out',
      preset: 'tree',
    }),
  },
};

export const PreviewingApproveEditCancel: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'previewing',
      previewPath: 'canvases/example.preview.canvas',
    }),
  },
};

export const WritingProgress: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'writing',
    }),
  },
};

export const TerminalDone: Story = {
  args: {
    controller: ctrl('create', {
      phase: 'done',
      insights: {
        hubs: [{ id: 'e1', name: 'Alice', degree: 5 }],
        components: { count: 2, sizes: [8, 3] },
        orphans: [],
        perTypeCount: { person: 5, team: 2 },
      },
    }),
  },
};
