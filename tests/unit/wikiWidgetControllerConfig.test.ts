import { describe, expect, it, vi } from 'vitest';
import { WikiWidgetController, type WikiPickerDeps } from '@/agent/wiki/widgetController';
import type { ProviderModel } from '@/providers/types';

function makeController(): WikiWidgetController {
  return new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
}

const MODELS_LMSTUDIO: readonly ProviderModel[] = [{ id: 'qwen3' }, { id: 'mistral' }];

const MODELS_OPENAI: readonly ProviderModel[] = [{ id: 'gpt-4o' }];

function picker(overrides: Partial<WikiPickerDeps> = {}): WikiPickerDeps {
  return {
    listModelsForProvider: async (id) =>
      id === 'lmstudio' ? MODELS_LMSTUDIO : id === 'openai' ? MODELS_OPENAI : [],
    requiresApiKey: (id) => id === 'openai',
    hasApiKey: () => true,
    ...overrides,
  };
}

describe('WikiWidgetController.startConfigPhase', () => {
  it('sets phase to awaiting_config with defaults preselected', async () => {
    const c = makeController();
    void c.startConfigPhase(picker(), {
      providers: ['lmstudio', 'openai'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'qwen3',
      originalAsk: 'Ingest something',
      sourcesSummary: 'https://x',
    });
    const vm = c.viewModel();
    expect(vm.phase).toBe('awaiting_config');
    expect(vm.config?.draftProviderId).toBe('lmstudio');
    expect(vm.config?.draftModel).toBe('qwen3');
  });

  it('loads models for default provider; transitions models.state idle → loading → ok', async () => {
    const c = makeController();
    let resolveList: (m: readonly ProviderModel[]) => void = () => {};
    const listP = new Promise<readonly ProviderModel[]>((res) => {
      resolveList = res;
    });
    void c.startConfigPhase(picker({ listModelsForProvider: () => listP }), {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'qwen3',
      originalAsk: '',
      sourcesSummary: '',
    });
    // Allow microtask flush to advance state to 'loading'.
    await Promise.resolve();
    expect(c.viewModel().config?.models.state).toBe('loading');
    resolveList(MODELS_LMSTUDIO);
    await listP;
    await Promise.resolve();
    expect(c.viewModel().config?.models.state).toBe('ok');
  });

  it('onConfirm resolves with override; clears resolver', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(picker(), {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'qwen3',
      originalAsk: '',
      sourcesSummary: '',
    });
    // Wait for models to load so onConfirm passes validation.
    await Promise.resolve();
    await Promise.resolve();
    c.onConfirm();
    const r = await promise;
    expect(r).toEqual({ providerId: 'lmstudio', model: 'qwen3' });
  });

  it('onCancel resolves with null', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(picker(), {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'qwen3',
      originalAsk: '',
      sourcesSummary: '',
    });
    c.onCancel();
    const r = await promise;
    expect(r).toBeNull();
  });

  it('onSelectProvider switches draftProviderId, recomputes apiKeyMissing', async () => {
    const c = makeController();
    void c.startConfigPhase(
      picker({ requiresApiKey: (id) => id === 'openai', hasApiKey: () => false }),
      {
        providers: ['lmstudio', 'openai'],
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        originalAsk: '',
        sourcesSummary: '',
      },
    );
    await Promise.resolve();
    expect(c.viewModel().config?.apiKeyMissing).toBe(false);
    c.onSelectProvider('openai');
    expect(c.viewModel().config?.draftProviderId).toBe('openai');
    expect(c.viewModel().config?.apiKeyMissing).toBe(true);
  });

  it('onConfirm blocked when apiKeyMissing → sets validationError', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(
      picker({ requiresApiKey: () => true, hasApiKey: () => false }),
      {
        providers: ['openai'],
        defaultProviderId: 'openai',
        defaultModel: 'gpt-4o',
        originalAsk: '',
        sourcesSummary: '',
      },
    );
    await Promise.resolve();
    c.onConfirm();
    expect(c.viewModel().config?.validationError).toMatch(/API key/);
    expect(c.viewModel().phase).toBe('awaiting_config');
    // Still pending — simulate cancel to clean up.
    c.onCancel();
    expect(await promise).toBeNull();
  });

  it('onConfirm blocked when no model picked → sets validationError', async () => {
    const c = makeController();
    const list = vi.fn(async () => [] as readonly ProviderModel[]);
    const promise = c.startConfigPhase(picker({ listModelsForProvider: list }), {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: '',
      originalAsk: '',
      sourcesSummary: '',
    });
    await Promise.resolve();
    await Promise.resolve();
    c.onConfirm();
    expect(c.viewModel().config?.validationError).toMatch(/model/i);
    c.onCancel();
    expect(await promise).toBeNull();
  });

  it('onSelectModel updates draftModel', async () => {
    const c = makeController();
    void c.startConfigPhase(picker(), {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'qwen3',
      originalAsk: '',
      sourcesSummary: '',
    });
    await Promise.resolve();
    c.onSelectModel('mistral');
    expect(c.viewModel().config?.draftModel).toBe('mistral');
  });

  it('models error state when listModelsForProvider rejects', async () => {
    const c = makeController();
    void c.startConfigPhase(
      picker({
        listModelsForProvider: async () => {
          throw new Error('boom');
        },
      }),
      {
        providers: ['lmstudio'],
        defaultProviderId: 'lmstudio',
        defaultModel: 'qwen3',
        originalAsk: '',
        sourcesSummary: '',
      },
    );
    // Wait for the rejection to propagate through the async chain.
    await new Promise<void>((res) => setTimeout(res, 0));
    expect(c.viewModel().config?.models.state).toBe('error');
  });

  it('dispose resolves pending picker promise with null', async () => {
    const c = makeController();
    const promise = c.startConfigPhase(picker(), {
      providers: ['lmstudio'],
      defaultProviderId: 'lmstudio',
      defaultModel: 'qwen3',
      originalAsk: '',
      sourcesSummary: '',
    });
    c.dispose();
    const r = await promise;
    expect(r).toBeNull();
  });
});
