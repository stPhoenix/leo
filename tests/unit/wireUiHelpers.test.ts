// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { wireUiHelpers } from '@/ui/wireUiHelpers';

function makeDeps() {
  const notice = { show: vi.fn() };
  const created: Array<{
    setText: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }> = [];
  const statusBar = {
    create: vi.fn(() => {
      const item = { setText: vi.fn(), clear: vi.fn(), remove: vi.fn() };
      created.push(item);
      return item;
    }),
  };
  const inlineDialog = {
    mount: vi.fn(() => vi.fn()),
    isNativeModal: () => false as const,
  };
  const inlineConfirmation = {
    present: vi.fn(() => vi.fn()),
    isNativeModal: () => false as const,
  };
  return { notice, statusBar, inlineDialog, inlineConfirmation, created };
}

describe('wireUiHelpers', () => {
  it('re-exports the visual-state + tool-icon helpers', () => {
    const deps = makeDeps();
    const w = wireUiHelpers(deps);
    const el = document.createElement('div');
    w.applyVisualState(el, 'streaming');
    expect(el.getAttribute('data-visual-state')).toBe('streaming');
    expect(w.ariaHintFor('streaming').ariaLive).toBe('polite');
    expect(w.iconFor('read_note').iconName).toBe('file-text');
    const render = w.renderToolIcon({ toolId: 'mcp.fs.list' });
    expect(render.source).toBe('mcp');
  });

  it('routes hub notice / status / blockingError / confirmation through the injected channels', () => {
    const deps = makeDeps();
    const w = wireUiHelpers(deps);
    w.hub.notice('hi');
    expect(deps.notice.show).toHaveBeenCalledWith('hi');

    w.hub.status('indexer', 'working…');
    expect(deps.statusBar.create).toHaveBeenCalledTimes(1);
    expect(deps.created[0]?.setText).toHaveBeenCalledWith('working…');

    const host = document.createElement('div');
    w.hub.blockingError(host, { title: 't', message: 'm' });
    expect(deps.inlineDialog.mount).toHaveBeenCalledTimes(1);

    w.hub.requestToolConfirmation({ toolId: 'read_note', args: {}, resolve: vi.fn() });
    expect(deps.inlineConfirmation.present).toHaveBeenCalledTimes(1);
  });

  it('dispose() calls hub.dispose() and is idempotent', () => {
    const deps = makeDeps();
    const w = wireUiHelpers(deps);
    w.hub.status('indexer', 'working…');
    w.dispose();
    expect(deps.created[0]?.remove).toHaveBeenCalledTimes(1);
    w.dispose();
    expect(deps.created[0]?.remove).toHaveBeenCalledTimes(1);
  });
});
