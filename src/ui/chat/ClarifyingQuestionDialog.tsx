import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type {
  ClarifyingQuestionController,
  ClarifyingQuestionOutcome,
  PendingClarifyingQuestion,
} from '@/agent/clarifyingQuestionController';

export interface ClarifyingQuestionSource {
  readonly current: () => PendingClarifyingQuestion | null;
  readonly subscribe: (cb: () => void) => () => void;
  readonly resolve: (outcome: ClarifyingQuestionOutcome) => void;
}

export function makeClarifyingQuestionSource(
  controller: ClarifyingQuestionController,
): ClarifyingQuestionSource {
  return {
    current: () => controller.current(),
    subscribe: (cb) => controller.subscribe(() => cb()),
    resolve: (outcome) => controller.resolve(outcome),
  };
}

const EMPTY_SOURCE: ClarifyingQuestionSource = {
  current: () => null,
  subscribe: () => () => undefined,
  resolve: () => undefined,
};

export interface ClarifyingQuestionDialogProps {
  readonly source?: ClarifyingQuestionSource;
  readonly hidden?: boolean;
}

export function ClarifyingQuestionDialog(props: ClarifyingQuestionDialogProps): JSX.Element {
  const source = props.source ?? EMPTY_SOURCE;
  const pending = useSyncExternalStore<PendingClarifyingQuestion | null>(
    source.subscribe,
    source.current,
    source.current,
  );
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [freeform, setFreeform] = useState<string>('');
  const sendRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const firstOptionRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelected([]);
    setFreeform('');
  }, [pending?.request]);

  useEffect(() => {
    if (pending === null) return;
    if (pending.request.options !== undefined && pending.request.options.length > 0) {
      firstOptionRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [pending]);

  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        source.resolve({ type: 'cancel' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, source]);

  if (pending === null) {
    return (
      <div
        className="leo-clarify"
        // NOSONAR S6819 — inline chat-flow modal; native <dialog> default styling conflicts with chat-list layout
        role="dialog"
        aria-modal="true"
        aria-label="clarifying question"
        data-region="clarify"
        hidden={props.hidden ?? true}
      />
    );
  }

  const { question, header, options, multiSelect } = pending.request;
  const hasOptions = options !== undefined && options.length > 0;
  const isMulti = multiSelect === true;
  const canSend = hasOptions ? selected.length > 0 : freeform.trim().length > 0;

  function send(): void {
    if (!canSend) return;
    if (hasOptions) {
      if (isMulti) {
        source.resolve({ type: 'answerMulti', answers: selected });
      } else {
        const first = selected[0];
        if (first === undefined) return;
        source.resolve({ type: 'answer', answer: first });
      }
    } else {
      source.resolve({ type: 'answer', answer: freeform.trim() });
    }
  }

  function toggle(option: string): void {
    if (isMulti) {
      setSelected((prev) =>
        prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option],
      );
    } else {
      setSelected([option]);
    }
  }

  return (
    <div
      className="leo-clarify leo-clarify-active"
      // NOSONAR S6819 — inline chat-flow modal; native <dialog> default styling conflicts with chat-list layout
      role="dialog"
      aria-modal="true"
      aria-label="Clarifying question"
      aria-live="assertive"
      data-region="clarify"
      data-multi-select={isMulti ? 'true' : 'false'}
    >
      <header className="leo-clarify-header" data-slot="clarify-header">
        {header !== undefined ? (
          <span className="leo-clarify-chip" data-slot="clarify-header-chip">
            {header}
          </span>
        ) : null}
        <strong>Clarifying question</strong>
      </header>
      <div className="leo-clarify-body" data-slot="clarify-body">
        <p className="leo-clarify-question" data-slot="clarify-question">
          {question}
        </p>
        {hasOptions ? (
          <ul
            className="leo-clarify-options"
            data-slot="clarify-options"
            // role="radiogroup" is correct for single-select; for multi-select, the buttons
            // form a checkbox group whose semantics come from the checkbox inputs themselves.
            role={isMulti ? undefined : 'radiogroup'}
            aria-label="Options"
          >
            {options!.map((opt, i) => {
              const id = `leo-clarify-opt-${i}`;
              const checked = selected.includes(opt);
              return (
                <li key={opt} className="leo-clarify-option">
                  <label htmlFor={id}>
                    <input
                      ref={i === 0 ? firstOptionRef : undefined}
                      id={id}
                      type={isMulti ? 'checkbox' : 'radio'}
                      name="leo-clarify-option"
                      value={opt}
                      checked={checked}
                      onChange={() => toggle(opt)}
                      data-slot="clarify-option-input"
                    />
                    <span data-slot="clarify-option-label">{opt}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <textarea
            ref={textareaRef}
            className="leo-clarify-textarea"
            data-slot="clarify-textarea"
            aria-label="Your answer"
            spellCheck={false}
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
          />
        )}
      </div>
      <div className="leo-clarify-actions" data-slot="clarify-actions">
        <button
          ref={sendRef}
          type="button"
          data-slot="clarify-send"
          disabled={!canSend}
          onClick={send}
        >
          Send
        </button>
        <button
          ref={cancelRef}
          type="button"
          data-slot="clarify-cancel"
          onClick={() => source.resolve({ type: 'cancel' })}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
