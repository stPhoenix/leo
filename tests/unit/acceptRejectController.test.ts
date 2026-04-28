import { describe, expect, it, vi } from 'vitest';
import { AcceptRejectController, type EditNoteProposal } from '@/agent/acceptRejectController';

function proposal(extra: Partial<EditNoteProposal> = {}): EditNoteProposal {
  return {
    toolId: 'edit_note',
    intent: 'edit',
    path: 'n.md',
    lineStart: 0,
    lineEnd: 1,
    routedVia: 'vault',
    ...extra,
  };
}

describe('AcceptRejectController', () => {
  it('present resolves with accept and fires onAccept', async () => {
    const c = new AcceptRejectController();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const p = c.present(proposal({ onAccept, onReject }));
    c.resolve('accept');
    await expect(p).resolves.toBe('accept');
    expect(onAccept).toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(c.current()).toBeNull();
  });

  it('present resolves with reject and fires onReject', async () => {
    const c = new AcceptRejectController();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const p = c.present(proposal({ onAccept, onReject }));
    c.resolve('reject');
    await expect(p).resolves.toBe('reject');
    expect(onReject).toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('a second present auto-accepts the prior pending', async () => {
    const c = new AcceptRejectController();
    const first = c.present(proposal({ toolId: 'first' }));
    const second = c.present(proposal({ toolId: 'second' }));
    c.resolve('reject');
    await expect(first).resolves.toBe('accept');
    await expect(second).resolves.toBe('reject');
  });

  it('dispose auto-accepts any pending proposal', async () => {
    const c = new AcceptRejectController();
    const p = c.present(proposal());
    c.dispose();
    await expect(p).resolves.toBe('accept');
  });
});
