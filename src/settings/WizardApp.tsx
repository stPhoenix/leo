import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ProviderModel } from '@/providers/types';
import { initialState, reduce, type WizardEvent, type WizardState } from './wizardMachine';

export interface WizardAppProps {
  readonly initialEndpoint: string;
  readonly initialChatModel: string;
  readonly initialEmbeddingModel: string;
  readonly probe: (endpoint: string) => Promise<ProviderModel[]>;
  readonly persist: (result: {
    endpoint: string;
    chatModel: string;
    embeddingModel: string;
  }) => Promise<void>;
  readonly onClose: () => void;
}

export function WizardApp(props: WizardAppProps): JSX.Element {
  const [state, dispatch] = useReducer<
    (s: WizardState, e: WizardEvent) => WizardState,
    WizardState
  >(reduce, null as unknown as WizardState, () =>
    initialState({
      endpoint: props.initialEndpoint,
      chatModel: props.initialChatModel,
      embeddingModel: props.initialEmbeddingModel,
    }),
  );
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (state.step !== 'probing') return;
    let cancelled = false;
    void (async () => {
      try {
        const models = await props.probe(state.endpoint);
        if (!cancelled && aliveRef.current) dispatch({ type: 'probeOk', models });
      } catch (err) {
        if (!cancelled && aliveRef.current) {
          dispatch({
            type: 'probeError',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.step, state.endpoint, props]);

  useEffect(() => {
    if (state.step !== 'persisting') return;
    let cancelled = false;
    void (async () => {
      try {
        await props.persist({
          endpoint: state.endpoint,
          chatModel: state.chatModel,
          embeddingModel: state.embeddingModel,
        });
        if (!cancelled && aliveRef.current) dispatch({ type: 'persistOk' });
      } catch (err) {
        if (!cancelled && aliveRef.current) {
          dispatch({
            type: 'persistError',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.step, state.endpoint, state.chatModel, state.embeddingModel, props]);

  useEffect(() => {
    if (state.step === 'closed') props.onClose();
  }, [state.step, props]);

  const cancel = useCallback(() => dispatch({ type: 'cancel' }), []);

  return (
    <div className="leo-wizard">
      <Stepper step={state.step} />
      <div className="leo-wizard-step">{renderStep(state, dispatch)}</div>
      <div className="leo-wizard-footer">
        <button type="button" onClick={cancel}>
          Cancel
        </button>
        {renderForward(state, dispatch)}
      </div>
    </div>
  );
}

function Stepper({ step }: { step: WizardState['step'] }): JSX.Element {
  const labels: Array<{ id: WizardState['step']; label: string }> = [
    { id: 'endpoint', label: '1 · Endpoint' },
    { id: 'probing', label: '2 · Probe' },
    { id: 'models', label: '3 · Models' },
    { id: 'save', label: '4 · Save' },
  ];
  const activeIndex = labels.findIndex((l) => matchActive(l.id, step));
  return (
    <ol className="leo-wizard-steps">
      {labels.map((l, i) => (
        <li key={l.id} className={i === activeIndex ? 'is-active' : ''}>
          {l.label}
        </li>
      ))}
    </ol>
  );
}

function matchActive(rep: WizardState['step'], current: WizardState['step']): boolean {
  if (rep === 'probing') return current === 'probing' || current === 'probe-failed';
  if (rep === 'models') return current === 'models' || current === 'models-empty';
  if (rep === 'save') return current === 'save' || current === 'persisting';
  return rep === current;
}

function renderStep(state: WizardState, dispatch: (e: WizardEvent) => void): JSX.Element {
  if (state.step === 'endpoint') {
    return (
      <label className="leo-wizard-field">
        <span>Endpoint URL</span>
        <input
          type="text"
          value={state.endpoint}
          onChange={(e) => dispatch({ type: 'editEndpoint', endpoint: e.target.value })}
          placeholder="http://localhost:1234"
        />
        <small>Tip: start LM Studio &gt; Developer &gt; Start Server.</small>
      </label>
    );
  }
  if (state.step === 'probing') {
    return <p>Contacting {state.endpoint}/v1/models …</p>;
  }
  if (state.step === 'probe-failed') {
    return (
      <div className="leo-wizard-error">
        <p>Could not reach endpoint.</p>
        <pre>{state.probeError ?? ''}</pre>
        <div className="leo-wizard-actions">
          <button type="button" onClick={() => dispatch({ type: 'back' })}>
            Edit endpoint
          </button>
          <button type="button" onClick={() => dispatch({ type: 'retry' })}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (state.step === 'models' || state.step === 'models-empty') {
    return (
      <ModelPickers state={state} dispatch={dispatch} freeText={state.step === 'models-empty'} />
    );
  }
  if (state.step === 'save' || state.step === 'persisting') {
    return (
      <div className="leo-wizard-summary">
        <dl>
          <dt>Endpoint</dt>
          <dd>{state.endpoint}</dd>
          <dt>Chat</dt>
          <dd>{state.chatModel}</dd>
          <dt>Embedding</dt>
          <dd>{state.embeddingModel}</dd>
        </dl>
        {state.persistError !== null ? (
          <p className="leo-wizard-error">{state.persistError}</p>
        ) : null}
      </div>
    );
  }
  return <></>;
}

function ModelPickers({
  state,
  dispatch,
  freeText,
}: {
  state: WizardState;
  dispatch: (e: WizardEvent) => void;
  freeText: boolean;
}): JSX.Element {
  return (
    <div className="leo-wizard-models">
      <label>
        <span>Chat model</span>
        {freeText ? (
          <input
            type="text"
            value={state.chatModel}
            onChange={(e) => dispatch({ type: 'editChatModel', id: e.target.value })}
          />
        ) : (
          <select
            value={state.chatModel}
            onChange={(e) => dispatch({ type: 'editChatModel', id: e.target.value })}
          >
            {state.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        )}
      </label>
      <label>
        <span>Embedding model</span>
        {freeText ? (
          <input
            type="text"
            value={state.embeddingModel}
            onChange={(e) => dispatch({ type: 'editEmbeddingModel', id: e.target.value })}
          />
        ) : (
          <select
            value={state.embeddingModel}
            onChange={(e) => dispatch({ type: 'editEmbeddingModel', id: e.target.value })}
          >
            {state.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        )}
      </label>
    </div>
  );
}

function renderForward(state: WizardState, dispatch: (e: WizardEvent) => void): JSX.Element {
  if (state.step === 'endpoint') {
    return (
      <button
        type="button"
        className="mod-cta"
        disabled={state.endpoint.trim().length === 0}
        onClick={() => dispatch({ type: 'next' })}
      >
        Next: Probe →
      </button>
    );
  }
  if (state.step === 'probing') {
    return (
      <button type="button" className="mod-cta" disabled>
        Probing…
      </button>
    );
  }
  if (state.step === 'probe-failed') return <></>;
  if (state.step === 'models' || state.step === 'models-empty') {
    const needBoth = state.chatModel.trim() === '' || state.embeddingModel.trim() === '';
    return (
      <>
        <button type="button" onClick={() => dispatch({ type: 'back' })}>
          ← Back
        </button>
        <button
          type="button"
          className="mod-cta"
          disabled={needBoth}
          onClick={() => dispatch({ type: 'next' })}
        >
          Next: Save
        </button>
      </>
    );
  }
  if (state.step === 'save' || state.step === 'persisting') {
    return (
      <>
        <button type="button" onClick={() => dispatch({ type: 'back' })}>
          ← Back
        </button>
        <button
          type="button"
          className="mod-cta"
          disabled={state.step === 'persisting'}
          onClick={() => dispatch({ type: 'next' })}
        >
          {state.step === 'persisting' ? 'Saving…' : 'Save & Close'}
        </button>
      </>
    );
  }
  return <></>;
}
