import { describe, expect, it } from 'vitest';
import { fetchCanvasSources } from '@/agent/canvas/fetch';
import type { CanvasSourceItem } from '@/agent/canvas/plan';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

function vaultPathItem(path: string): CanvasSourceItem {
  return { kind: 'vaultPath', resolvedRef: path, hint: { kind: 'mention', path } };
}

function conversationItem(title: string, body: string): CanvasSourceItem {
  return {
    kind: 'conversation',
    resolvedRef: title,
    hint: { kind: 'conversation', title, body },
    conversation: { title, body },
  };
}

describe('fetchCanvasSources', () => {
  it('partial success: 4/5 succeed, failedAll = false', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    await vault.write('b.md', '# B');
    await vault.write('c.md', '# C');
    await vault.write('d.md', '# D');
    const items: CanvasSourceItem[] = [
      vaultPathItem('a.md'),
      vaultPathItem('b.md'),
      vaultPathItem('c.md'),
      vaultPathItem('d.md'),
      vaultPathItem('missing.md'),
    ];
    const result = await fetchCanvasSources(items, { vault }, new AbortController().signal);
    expect(result.items.length).toBe(5);
    expect(result.items.filter((i) => i.status === 'fetched').length).toBe(4);
    expect(result.failedAll).toBe(false);
  });

  it('all-fail: failedAll = true', async () => {
    const vault = new InMemoryVaultAdapter();
    const items: CanvasSourceItem[] = [vaultPathItem('miss-a.md'), vaultPathItem('miss-b.md')];
    const result = await fetchCanvasSources(items, { vault }, new AbortController().signal);
    expect(result.failedAll).toBe(true);
  });

  it('verbatim error code from fetcher (fetch_vault_missing)', async () => {
    const vault = new InMemoryVaultAdapter();
    const result = await fetchCanvasSources(
      [vaultPathItem('absent.md')],
      { vault },
      new AbortController().signal,
    );
    expect(result.items[0]!.status).toBe('error');
    expect(result.items[0]!.errorCode).toBe('fetch_vault_missing');
  });

  it('aborted signal surfaces aborted error code without throwing', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await fetchCanvasSources([vaultPathItem('a.md')], { vault }, ctrl.signal);
    // fetchIngestSource returns code:'fetch_failed', message:'aborted' on aborted signal.
    expect(result.items[0]!.status).toBe('error');
    expect(result.items[0]!.errorMessage).toMatch(/abort/i);
  });

  it('per-source rejection does not cancel siblings', async () => {
    const vault = new InMemoryVaultAdapter();
    await vault.write('a.md', '# A');
    const items: CanvasSourceItem[] = [vaultPathItem('a.md'), vaultPathItem('miss.md')];
    const result = await fetchCanvasSources(items, { vault }, new AbortController().signal);
    expect(result.items[0]!.status).toBe('fetched');
    expect(result.items[1]!.status).toBe('error');
  });

  it('conversation source maps via threadId/turnIndex synthesizer', async () => {
    const vault = new InMemoryVaultAdapter();
    const items: CanvasSourceItem[] = [conversationItem('Chat title', 'hello body')];
    const result = await fetchCanvasSources(items, { vault }, new AbortController().signal);
    expect(result.items[0]!.status).toBe('fetched');
    expect(result.items[0]!.fetched?.body).toBe('hello body');
  });

  it('empty input returns empty result, failedAll=false', async () => {
    const vault = new InMemoryVaultAdapter();
    const result = await fetchCanvasSources([], { vault }, new AbortController().signal);
    expect(result.items).toEqual([]);
    expect(result.failedAll).toBe(false);
  });
});
