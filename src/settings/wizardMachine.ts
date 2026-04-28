import type { ProviderModel } from '@/providers/types';

export type WizardStep =
  | 'endpoint'
  | 'probing'
  | 'probe-failed'
  | 'models'
  | 'models-empty'
  | 'save'
  | 'persisting'
  | 'closed';

export interface WizardState {
  readonly step: WizardStep;
  readonly endpoint: string;
  readonly models: readonly ProviderModel[];
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly probeError: string | null;
  readonly persistError: string | null;
}

export type WizardEvent =
  | { type: 'editEndpoint'; endpoint: string }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'cancel' }
  | { type: 'probeOk'; models: readonly ProviderModel[] }
  | { type: 'probeError'; message: string }
  | { type: 'editChatModel'; id: string }
  | { type: 'editEmbeddingModel'; id: string }
  | { type: 'persistOk' }
  | { type: 'persistError'; message: string }
  | { type: 'retry' };

export function initialState(seed: {
  endpoint: string;
  chatModel: string;
  embeddingModel: string;
}): WizardState {
  return {
    step: 'endpoint',
    endpoint: seed.endpoint,
    models: [],
    chatModel: seed.chatModel,
    embeddingModel: seed.embeddingModel,
    probeError: null,
    persistError: null,
  };
}

export function reduce(state: WizardState, event: WizardEvent): WizardState {
  if (event.type === 'cancel') return { ...state, step: 'closed' };

  switch (state.step) {
    case 'endpoint':
      if (event.type === 'editEndpoint') return { ...state, endpoint: event.endpoint };
      if (event.type === 'next' && state.endpoint.trim().length > 0) {
        return { ...state, step: 'probing', probeError: null };
      }
      return state;

    case 'probing':
      if (event.type === 'probeOk') {
        const defaults = inferDefaults(event.models, state);
        return {
          ...state,
          models: event.models,
          chatModel: defaults.chat,
          embeddingModel: defaults.embedding,
          step: event.models.length > 0 ? 'models' : 'models-empty',
        };
      }
      if (event.type === 'probeError') {
        return { ...state, step: 'probe-failed', probeError: event.message };
      }
      return state;

    case 'probe-failed':
      if (event.type === 'back') return { ...state, step: 'endpoint', probeError: null };
      if (event.type === 'retry') return { ...state, step: 'probing', probeError: null };
      return state;

    case 'models':
    case 'models-empty':
      if (event.type === 'editChatModel') return { ...state, chatModel: event.id };
      if (event.type === 'editEmbeddingModel') return { ...state, embeddingModel: event.id };
      if (event.type === 'back') return { ...state, step: 'endpoint' };
      if (event.type === 'next' && canSave(state, state.step === 'models-empty')) {
        return { ...state, step: 'save' };
      }
      return state;

    case 'save':
      if (event.type === 'back') {
        return { ...state, step: state.models.length > 0 ? 'models' : 'models-empty' };
      }
      if (event.type === 'next') return { ...state, step: 'persisting', persistError: null };
      return state;

    case 'persisting':
      if (event.type === 'persistOk') return { ...state, step: 'closed' };
      if (event.type === 'persistError') {
        return { ...state, step: 'save', persistError: event.message };
      }
      return state;

    case 'closed':
      return state;

    default:
      return state;
  }
}

function inferDefaults(
  models: readonly ProviderModel[],
  prev: WizardState,
): { chat: string; embedding: string } {
  if (models.length === 0) {
    return { chat: prev.chatModel, embedding: prev.embeddingModel };
  }
  const ids = models.map((m) => m.id);
  const chat =
    prev.chatModel !== '' && ids.includes(prev.chatModel)
      ? prev.chatModel
      : (ids.find((id) => !/embed/i.test(id)) ?? ids[0]!);
  const embedding =
    prev.embeddingModel !== '' && ids.includes(prev.embeddingModel)
      ? prev.embeddingModel
      : (ids.find((id) => /embed/i.test(id)) ?? ids[0]!);
  return { chat, embedding };
}

function canSave(state: WizardState, allowFreeText: boolean): boolean {
  if (allowFreeText) {
    return state.chatModel.trim().length > 0 && state.embeddingModel.trim().length > 0;
  }
  return state.chatModel.length > 0 && state.embeddingModel.length > 0;
}
