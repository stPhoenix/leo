import { describe, expect, it, vi } from 'vitest';
import { createWikiStatusCommand } from '@/ui/wikiStatusCommand';
import { WIKI_MUTEX_IDLE } from '@/agent/wiki/mutexTypes';
import type { WikiStatus } from '@/agent/wiki/wikiStatus';

const SAMPLE_STATUS: WikiStatus = {
  indexPageCount: 3,
  indexSizeBytes: 128,
  lastLintTimestamp: '2026-04-29T08:00:00Z',
  lastLintRunId: 'lnt-1',
  orphanPageCount: 1,
  orphanRawCount: 0,
  mutexState: WIKI_MUTEX_IDLE,
};

describe('createWikiStatusCommand', () => {
  it('collects then renders on invoke', async () => {
    const collect = vi.fn(async () => SAMPLE_STATUS);
    const render = vi.fn();
    const onError = vi.fn();
    const cmd = createWikiStatusCommand({ collect, render, onError });
    await cmd.invoke();
    expect(collect).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledWith(SAMPLE_STATUS);
    expect(onError).not.toHaveBeenCalled();
  });

  it('aborts a previous in-flight invoke when a new one starts', async () => {
    let resolveFirst: ((s: WikiStatus) => void) | null = null;
    const seenSignals: AbortSignal[] = [];
    const collect = vi.fn(
      (signal: AbortSignal) =>
        new Promise<WikiStatus>((resolve, reject) => {
          seenSignals.push(signal);
          if (resolveFirst === null) {
            resolveFirst = resolve;
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          } else {
            resolve(SAMPLE_STATUS);
          }
        }),
    );
    const render = vi.fn();
    const cmd = createWikiStatusCommand({
      collect,
      render,
      onError: () => undefined,
    });

    const first = cmd.invoke();
    const second = cmd.invoke();
    expect(seenSignals[0]?.aborted).toBe(true);
    await Promise.allSettled([first, second]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenLastCalledWith(SAMPLE_STATUS);
  });

  it('routes errors to onError', async () => {
    const err = new Error('boom');
    const collect = vi.fn(async () => {
      throw err;
    });
    const render = vi.fn();
    const onError = vi.fn();
    const cmd = createWikiStatusCommand({ collect, render, onError });
    await cmd.invoke();
    expect(onError).toHaveBeenCalledWith(err);
    expect(render).not.toHaveBeenCalled();
  });
});
