export type SignalListener<T> = (payload: T) => void;

export interface Signal<T = void> {
  subscribe(listener: SignalListener<T>): () => void;
  emit(payload: T): void;
}

export function createSignal<T = void>(): Signal<T> {
  const listeners = new Set<SignalListener<T>>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    emit(payload) {
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch {
          /* isolate listener failures */
        }
      }
    },
  };
}
