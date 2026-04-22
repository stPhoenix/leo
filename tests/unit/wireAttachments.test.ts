import { describe, expect, it, vi } from 'vitest';
import { wireAttachments } from '@/chat/wireAttachments';

describe('wireAttachments', () => {
  it('exposes the store + re-exported helpers', () => {
    const w = wireAttachments();
    expect(w.store).toBeDefined();
    const blocks = w.buildUserContent('hi', []);
    expect(blocks).toEqual([{ type: 'text', text: 'hi' }]);
    expect(w.estimateTokens(blocks)).toBeGreaterThanOrEqual(0);
    expect(w.isVisionGateBlocked({ attachments: [], modelSupportsVision: false })).toBe(false);
    expect(w.detectVaultDrop({ textPlain: '[[notes/a.md]]' })).toEqual({
      wikilink: '[[notes/a.md]]',
      path: 'notes/a.md',
    });
  });

  it('dispose() revokes outstanding blob URLs and is idempotent', () => {
    const revoke = vi.fn();
    const w = wireAttachments({
      createObjectURL: () => 'blob:one',
      revokeObjectURL: revoke,
    });
    w.store.capture([{ name: 'a.png', mimeType: 'image/png', size: 8, bytes: new Uint8Array(8) }]);
    w.dispose();
    w.dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
