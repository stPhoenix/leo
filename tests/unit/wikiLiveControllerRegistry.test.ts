import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WIKI_LIVE_KIND,
  clearWikiLiveControllers,
  lookupWikiLiveController,
  registerWikiLiveController,
  releaseWikiLiveController,
  wikiLiveControllerCount,
} from '@/agent/wiki/liveControllerRegistry';

afterEach(clearWikiLiveControllers);

describe('liveControllerRegistry', () => {
  it('register + lookup roundtrip', () => {
    const ctrl = { dispose: vi.fn() };
    registerWikiLiveController('run-1', ctrl);
    expect(lookupWikiLiveController('run-1')).toBe(ctrl);
    expect(wikiLiveControllerCount()).toBe(1);
  });

  it('register is idempotent — same runId overwrites without doubling count', () => {
    const a = { dispose: vi.fn() };
    const b = { dispose: vi.fn() };
    registerWikiLiveController('run-1', a);
    registerWikiLiveController('run-1', b);
    expect(wikiLiveControllerCount()).toBe(1);
    expect(lookupWikiLiveController('run-1')).toBe(b);
  });

  it('release calls dispose then removes; release of unknown runId is a no-op', () => {
    const ctrl = { dispose: vi.fn() };
    registerWikiLiveController('run-1', ctrl);
    releaseWikiLiveController('run-1');
    expect(ctrl.dispose).toHaveBeenCalledOnce();
    expect(lookupWikiLiveController('run-1')).toBeNull();
    // Idempotent
    releaseWikiLiveController('run-1');
    expect(ctrl.dispose).toHaveBeenCalledOnce();
  });

  it('release swallows dispose throws', () => {
    const ctrl = {
      dispose: () => {
        throw new Error('boom');
      },
    };
    registerWikiLiveController('run-1', ctrl);
    expect(() => releaseWikiLiveController('run-1')).not.toThrow();
    expect(lookupWikiLiveController('run-1')).toBeNull();
  });

  it('exports widget kind constant', () => {
    expect(WIKI_LIVE_KIND).toBe('wiki_live');
  });
});
