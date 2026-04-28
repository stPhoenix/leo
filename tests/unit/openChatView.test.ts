import { describe, expect, it, vi } from 'vitest';
import { openOrFocusChatView } from '@/ui/openChatView';
import { VIEW_TYPE_LEO_CHAT } from '@/ui/viewType';

interface FakeLeaf {
  detach: ReturnType<typeof vi.fn>;
  setViewState: ReturnType<typeof vi.fn>;
  type?: string;
}

function makeLeaf(type?: string): FakeLeaf {
  return {
    detach: vi.fn(),
    setViewState: vi.fn(),
    type,
  };
}

function makeWorkspace(opts: {
  leaves?: FakeLeaf[];
  active?: FakeLeaf | null;
  rightLeaf?: FakeLeaf | null;
}) {
  const reveal = vi.fn();
  const setActive = vi.fn();
  return {
    workspace: {
      getLeavesOfType: vi.fn(() => opts.leaves ?? []),
      getRightLeaf: vi.fn(() => opts.rightLeaf ?? null),
      revealLeaf: reveal,
      setActiveLeaf: setActive,
      activeLeaf: opts.active ?? null,
    } as unknown as Parameters<typeof openOrFocusChatView>[0],
    reveal,
    setActive,
  };
}

describe('openOrFocusChatView', () => {
  it('opens a new leaf in the right sidebar when none exists', async () => {
    const right = makeLeaf();
    const { workspace, reveal } = makeWorkspace({ leaves: [], rightLeaf: right });
    const action = await openOrFocusChatView(workspace);
    expect(action).toBe('opened');
    expect(right.setViewState).toHaveBeenCalledWith({ type: VIEW_TYPE_LEO_CHAT, active: true });
    expect(reveal).toHaveBeenCalledWith(right);
  });

  it('reveals + focuses an existing leaf when one is already registered', async () => {
    const existing = makeLeaf(VIEW_TYPE_LEO_CHAT);
    const { workspace, reveal, setActive } = makeWorkspace({ leaves: [existing] });
    const action = await openOrFocusChatView(workspace);
    expect(action).toBe('revealed');
    expect(reveal).toHaveBeenCalledWith(existing);
    expect(setActive).toHaveBeenCalledWith(existing, { focus: true });
  });

  it('toggles closed when called with toggle:true on the active leaf', async () => {
    const existing = makeLeaf(VIEW_TYPE_LEO_CHAT);
    const { workspace } = makeWorkspace({ leaves: [existing], active: existing });
    const action = await openOrFocusChatView(workspace, { toggle: true });
    expect(action).toBe('closed');
    expect(existing.detach).toHaveBeenCalled();
  });

  it('returns no-op when no right leaf is available', async () => {
    const { workspace } = makeWorkspace({ leaves: [], rightLeaf: null });
    const action = await openOrFocusChatView(workspace);
    expect(action).toBe('no-op');
  });
});
