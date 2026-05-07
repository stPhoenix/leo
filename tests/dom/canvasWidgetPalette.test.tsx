// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CanvasWidget } from '@/ui/chat/blocks/CanvasWidget';
import { CanvasWidgetController } from '@/agent/canvas/widget/widgetController';
import { paletteFor } from '@/agent/canvas/layouts/colorPalette';

afterEach(cleanup);

function buildController(): CanvasWidgetController {
  const c = new CanvasWidgetController({
    runId: 'r1',
    threadId: 't1',
    op: 'create',
    targetPath: 'canvases/x.canvas',
    originalAsk: 'sample ask',
  });
  c.update({
    phase: 'awaiting_config',
    config: {
      providers: ['lmstudio'],
      draftProviderId: 'lmstudio',
      draftModel: 'm1',
      draftPreset: 'auto',
      draftPath: 'canvases/x.canvas',
      draftPaletteId: 'coolVivid',
      models: { state: 'ok', items: [{ id: 'm1' }] },
      defaultProviderId: 'lmstudio',
      defaultModel: 'm1',
      defaultPreset: 'auto',
      defaultPath: 'canvases/x.canvas',
      defaultPaletteId: 'coolVivid',
      apiKeyMissing: false,
      validationError: null,
      originalAsk: 'sample ask',
    },
  });
  return c;
}

describe('CanvasWidget — palette picker', () => {
  it('renders palette select with all preset options', () => {
    const c = buildController();
    const { container } = render(<CanvasWidget controller={c} />);
    const select = container.querySelector(
      '[data-slot="canvas-config-palette"]',
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    const optionValues = Array.from(select!.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toContain('coolVivid');
    expect(optionValues).toContain('rainbow');
    expect(optionValues).toContain('forestSteel');
  });

  it('renders 6 swatches matching the picked palette', () => {
    const c = buildController();
    const { container } = render(<CanvasWidget controller={c} />);
    const swatches = container.querySelectorAll('.leo-canvas-palette-swatch');
    expect(swatches.length).toBe(6);
    const colors = Array.from(swatches).map((el) => el.getAttribute('data-color'));
    expect(colors).toEqual([...paletteFor('coolVivid').colors]);
  });

  it('changing palette select updates swatches', () => {
    const c = buildController();
    const { container } = render(<CanvasWidget controller={c} />);
    const select = container.querySelector(
      '[data-slot="canvas-config-palette"]',
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'rainbow' } });
    const swatches = container.querySelectorAll('.leo-canvas-palette-swatch');
    const colors = Array.from(swatches).map((el) => el.getAttribute('data-color'));
    expect(colors).toEqual([...paletteFor('rainbow').colors]);
    expect(c.viewModel().config?.draftPaletteId).toBe('rainbow');
  });
});
