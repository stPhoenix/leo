import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_AGENT_LIVE_KIND,
  liveControllerCount,
  lookupLiveController,
  registerLiveController,
  unregisterLiveController,
} from '@/agent/externalAgent/liveControllerRegistry';
import type { ExternalAgentWidgetController } from '@/agent/externalAgent/widgetController';

interface FakeController {
  wasDisposed: boolean;
  dispose(): void;
}

function fakeController(opts?: { throwOnDispose?: boolean }): {
  asController: ExternalAgentWidgetController;
  fake: FakeController;
} {
  const fake: FakeController = {
    wasDisposed: false,
    dispose(): void {
      if (opts?.throwOnDispose === true) throw new Error('boom');
      fake.wasDisposed = true;
    },
  };
  return { asController: fake as unknown as ExternalAgentWidgetController, fake };
}

describe('liveControllerRegistry', () => {
  it('exports a stable kind constant', () => {
    expect(EXTERNAL_AGENT_LIVE_KIND).toBe('external_agent_live');
  });

  it('register/lookup/unregister round-trip', () => {
    const id = 'live-1';
    const { asController, fake } = fakeController();
    registerLiveController(id, asController);
    expect(lookupLiveController(id)).toBe(asController);
    unregisterLiveController(id);
    expect(lookupLiveController(id)).toBeNull();
    expect(fake.wasDisposed).toBe(true);
  });

  it('unregister calls dispose() on the controller', () => {
    const id = 'live-2';
    const { asController, fake } = fakeController();
    registerLiveController(id, asController);
    expect(fake.wasDisposed).toBe(false);
    unregisterLiveController(id);
    expect(fake.wasDisposed).toBe(true);
  });

  it('unregister of unknown runId is a no-op', () => {
    expect(() => unregisterLiveController('does-not-exist')).not.toThrow();
    expect(lookupLiveController('does-not-exist')).toBeNull();
  });

  it('dispose failure is swallowed (registry still removes entry)', () => {
    const id = 'live-3';
    const { asController } = fakeController({ throwOnDispose: true });
    registerLiveController(id, asController);
    expect(() => unregisterLiveController(id)).not.toThrow();
    expect(lookupLiveController(id)).toBeNull();
  });

  it('liveControllerCount tracks registrations', () => {
    const a = 'live-4a';
    const b = 'live-4b';
    const before = liveControllerCount();
    registerLiveController(a, fakeController().asController);
    registerLiveController(b, fakeController().asController);
    expect(liveControllerCount()).toBe(before + 2);
    unregisterLiveController(a);
    unregisterLiveController(b);
    expect(liveControllerCount()).toBe(before);
  });

  it('re-register on same runId overwrites the previous entry without disposing', () => {
    const id = 'live-5';
    const first = fakeController();
    const second = fakeController();
    registerLiveController(id, first.asController);
    registerLiveController(id, second.asController);
    expect(lookupLiveController(id)).toBe(second.asController);
    unregisterLiveController(id);
    expect(second.fake.wasDisposed).toBe(true);
    // first was overwritten silently — registry contract (no auto-dispose).
    expect(first.fake.wasDisposed).toBe(false);
  });
});
