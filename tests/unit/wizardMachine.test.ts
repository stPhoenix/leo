import { describe, expect, it } from 'vitest';
import { initialState, reduce, type WizardState } from '@/settings/wizardMachine';

function seed(): WizardState {
  return initialState({
    endpoint: 'http://localhost:1234',
    chatModel: '',
    embeddingModel: '',
  });
}

describe('wizardMachine — initial state', () => {
  it('starts at endpoint with seeded values', () => {
    const s = seed();
    expect(s.step).toBe('endpoint');
    expect(s.endpoint).toBe('http://localhost:1234');
    expect(s.models).toEqual([]);
  });
});

describe('wizardMachine — endpoint → probing', () => {
  it('updates endpoint on editEndpoint', () => {
    const s = reduce(seed(), { type: 'editEndpoint', endpoint: 'http://x:9999' });
    expect(s.endpoint).toBe('http://x:9999');
    expect(s.step).toBe('endpoint');
  });

  it('next transitions to probing when endpoint is non-empty', () => {
    const s = reduce(seed(), { type: 'next' });
    expect(s.step).toBe('probing');
    expect(s.probeError).toBeNull();
  });

  it('next is a no-op when endpoint is blank', () => {
    const blank = reduce(seed(), { type: 'editEndpoint', endpoint: '   ' });
    const s = reduce(blank, { type: 'next' });
    expect(s.step).toBe('endpoint');
  });
});

describe('wizardMachine — probing outcomes', () => {
  it('probeOk with non-empty list goes to models and seeds defaults', () => {
    const probing = reduce(seed(), { type: 'next' });
    const s = reduce(probing, {
      type: 'probeOk',
      models: [{ id: 'qwen2.5' }, { id: 'nomic-embed-text' }],
    });
    expect(s.step).toBe('models');
    expect(s.models).toHaveLength(2);
    expect(s.chatModel).toBe('qwen2.5');
    expect(s.embeddingModel).toBe('nomic-embed-text');
  });

  it('probeOk with empty list goes to models-empty', () => {
    const probing = reduce(seed(), { type: 'next' });
    const s = reduce(probing, { type: 'probeOk', models: [] });
    expect(s.step).toBe('models-empty');
  });

  it('probeError records the message and goes to probe-failed', () => {
    const probing = reduce(seed(), { type: 'next' });
    const s = reduce(probing, { type: 'probeError', message: 'ECONNREFUSED' });
    expect(s.step).toBe('probe-failed');
    expect(s.probeError).toBe('ECONNREFUSED');
  });

  it('probe-failed → back returns to endpoint, → retry returns to probing', () => {
    const probing = reduce(seed(), { type: 'next' });
    const failed = reduce(probing, { type: 'probeError', message: 'x' });
    expect(reduce(failed, { type: 'back' }).step).toBe('endpoint');
    expect(reduce(failed, { type: 'retry' }).step).toBe('probing');
  });
});

describe('wizardMachine — models → save → persist', () => {
  function reachModels(): WizardState {
    return reduce(reduce(seed(), { type: 'next' }), {
      type: 'probeOk',
      models: [{ id: 'qwen2.5' }, { id: 'nomic-embed-text' }],
    });
  }

  it('models → next requires both fields filled, then advances to save', () => {
    const m = reachModels();
    expect(reduce(m, { type: 'next' }).step).toBe('save');
    const cleared = reduce(m, { type: 'editChatModel', id: '' });
    expect(reduce(cleared, { type: 'next' }).step).toBe('models');
  });

  it('save → next goes through persisting; persistOk closes', () => {
    const save = reduce(reachModels(), { type: 'next' });
    const persisting = reduce(save, { type: 'next' });
    expect(persisting.step).toBe('persisting');
    expect(reduce(persisting, { type: 'persistOk' }).step).toBe('closed');
  });

  it('persistError surfaces back to save with the message', () => {
    const save = reduce(reachModels(), { type: 'next' });
    const persisting = reduce(save, { type: 'next' });
    const back = reduce(persisting, { type: 'persistError', message: 'disk full' });
    expect(back.step).toBe('save');
    expect(back.persistError).toBe('disk full');
  });

  it('save → back returns to the picker', () => {
    const save = reduce(reachModels(), { type: 'next' });
    expect(reduce(save, { type: 'back' }).step).toBe('models');
  });
});

describe('wizardMachine — cancel', () => {
  it.each<WizardState['step']>([
    'endpoint',
    'probing',
    'probe-failed',
    'models',
    'save',
    'persisting',
  ])('cancel from %s closes the wizard', (from) => {
    const s = { ...seed(), step: from };
    expect(reduce(s, { type: 'cancel' }).step).toBe('closed');
  });
});
