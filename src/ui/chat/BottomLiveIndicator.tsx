import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ChatMessageRecord } from '@/chat/types';
import type { ChatMessageStore } from '@/chat/messageStore';
import type { StreamingPhase } from '@/chat/streamingController';
import type { RunStateSource } from './blocks/toolUseStatus';

export interface BottomLiveIndicatorProps {
  readonly messageStore: ChatMessageStore;
  readonly phaseSource: PhaseSource;
  readonly runState?: RunStateSource;
  readonly lastEventAtSource?: () => number | null;
  readonly onCancel?: () => void;
  readonly stalledThresholdMs?: number;
  readonly tickIntervalMs?: number;
  readonly now?: () => number;
  readonly resolveToolName?: (id: string) => string;
  readonly setInterval?: (cb: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export interface PhaseSource {
  readonly getPhase: () => StreamingPhase;
  readonly subscribe: (cb: () => void) => () => void;
}

export function BottomLiveIndicator(props: BottomLiveIndicatorProps): JSX.Element | null {
  const phase = useSyncExternalStore(props.phaseSource.subscribe, props.phaseSource.getPhase);
  const messages = useSyncExternalStore(
    props.messageStore.subscribe,
    props.messageStore.getSnapshot,
  );
  const runStateSnapshot = useRunStateSnapshot(props.runState);
  const inProgressIds = Array.from(runStateSnapshot.inProgressToolUseIds);
  const stalledMs = props.stalledThresholdMs ?? 10000;
  const tickMs = props.tickIntervalMs ?? 1000;
  const now = props.now ?? (() => Date.now());

  // Tick state for elapsed/stalled re-evaluation.
  const [, setTick] = useState<number>(0);
  useEffect(() => {
    if (phase !== 'streaming' && phase !== 'cancelling' && inProgressIds.length === 0) return;
    const set = props.setInterval ?? globalThis.setInterval;
    const clear = props.clearInterval ?? globalThis.clearInterval;
    const handle = set(() => setTick((t) => t + 1), tickMs);
    return () => clear(handle as ReturnType<typeof globalThis.setInterval>);
  }, [phase, inProgressIds.length, tickMs, props.setInterval, props.clearInterval]);

  useEffect(() => {
    if (props.onCancel === undefined) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (phase !== 'streaming' && inProgressIds.length === 0) return;
      e.preventDefault();
      props.onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, inProgressIds.length, props.onCancel]);

  const lastMsg = lastAssistantMessage(messages);
  const lastBlockKind = lastMsg?.blocks?.[lastMsg.blocks.length - 1]?.type ?? null;
  const lastEventAt = props.lastEventAtSource?.() ?? null;
  const stalledFor = lastEventAt !== null ? Math.max(0, now() - lastEventAt) : 0;
  const isStalled = lastEventAt !== null && stalledFor > stalledMs;

  const visible = phase === 'streaming' || phase === 'cancelling' || inProgressIds.length > 0;
  if (!visible) return null;

  const label = pickLabel({
    phase,
    inProgressIds,
    lastBlockKind,
    isStalled,
    stalledFor,
    resolveToolName: props.resolveToolName,
  });

  return (
    <div
      className={`leo-live-indicator${isStalled ? ' is-stalled' : ''}`}
      role="status"
      aria-live="polite"
      data-slot="live-indicator"
      data-phase={phase}
      data-stalled={isStalled ? 'true' : 'false'}
    >
      <span data-slot="live-indicator-label">{label}</span>
      {props.onCancel !== undefined ? (
        <button
          type="button"
          className="leo-live-indicator-stop"
          data-slot="live-indicator-stop"
          onClick={() => props.onCancel?.()}
          aria-label="Cancel (Esc)"
        >
          ⎋ Esc
        </button>
      ) : null}
    </div>
  );
}

function pickLabel(input: {
  phase: StreamingPhase;
  inProgressIds: readonly string[];
  lastBlockKind: string | null;
  isStalled: boolean;
  stalledFor: number;
  resolveToolName?: (id: string) => string;
}): string {
  if (input.isStalled) {
    const seconds = Math.floor(input.stalledFor / 1000);
    return `Working… (no output for ${seconds}s)`;
  }
  if (input.inProgressIds.length === 1) {
    const id = input.inProgressIds[0]!;
    const name = input.resolveToolName?.(id) ?? id;
    return `Running ${name}`;
  }
  if (input.inProgressIds.length > 1) {
    const id = input.inProgressIds[0]!;
    const first = input.resolveToolName?.(id) ?? id;
    return `Running ${input.inProgressIds.length} tools (${first} +${
      input.inProgressIds.length - 1
    })`;
  }
  if (input.lastBlockKind === 'thinking') return 'Reasoning…';
  if (input.phase === 'streaming') return 'Thinking…';
  if (input.phase === 'cancelling') return 'Cancelling…';
  return '…';
}

function lastAssistantMessage(messages: readonly ChatMessageRecord[]): ChatMessageRecord | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'assistant') return messages[i]!;
  }
  return null;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function useRunStateSnapshot(source: RunStateSource | undefined): {
  inProgressToolUseIds: ReadonlySet<string>;
} {
  const subscribe = (cb: () => void): (() => void) => {
    if (source === undefined) return () => undefined;
    return source.subscribe(cb);
  };
  const get = (): ReadonlySet<string> =>
    source === undefined ? EMPTY_SET : source.getSnapshot().inProgressToolUseIds;
  const ids = useSyncExternalStore(subscribe, get, get);
  return { inProgressToolUseIds: ids };
}
