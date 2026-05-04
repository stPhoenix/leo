import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import type { DrainEvent, DrainListener } from '@/indexer/vaultIndexer';

export interface IndexStatusSource {
  readonly hasIndex: () => boolean;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface IndexErrorEntry {
  readonly path?: string;
  readonly message: string;
}

export interface IndexProgressSnapshot {
  readonly busy: boolean;
  readonly indexed: number;
  readonly total: number;
  readonly currentPath: string | null;
  readonly dirty: number;
  readonly errors: ReadonlyArray<IndexErrorEntry>;
  readonly completedAt: number | null;
}

export type IndexBlockVariant = 'not-indexed' | 'dirty' | 'indexing' | 'errors' | 'complete';

export interface IndexStatusBlockProps {
  readonly source?: IndexStatusSource;
  readonly drainSubscribe?: (listener: DrainListener) => () => void;
  readonly onReindexAll?: () => void;
  readonly onReindexChanged?: () => void;
  readonly progressOverride?: IndexProgressSnapshot;
  readonly hasIndexOverride?: boolean;
  readonly completeToastMs?: number;
}

const EMPTY_SOURCE: IndexStatusSource = {
  hasIndex: () => true,
  subscribe: () => () => undefined,
};

const INITIAL_PROGRESS: IndexProgressSnapshot = {
  busy: false,
  indexed: 0,
  total: 0,
  currentPath: null,
  dirty: 0,
  errors: [],
  completedAt: null,
};

const DEFAULT_COMPLETE_TOAST_MS = 4_000;

function reduce(state: IndexProgressSnapshot, event: DrainEvent): IndexProgressSnapshot {
  switch (event.kind) {
    case 'start':
      return {
        ...state,
        busy: event.size > 0,
        indexed: 0,
        total: event.size,
        currentPath: null,
        errors: [],
      };
    case 'tick': {
      const total = state.total > 0 ? state.total : event.remaining + 1;
      const indexed = Math.max(0, total - event.remaining);
      return { ...state, indexed, total, currentPath: event.path, busy: event.remaining > 0 };
    }
    case 'complete':
      return {
        ...state,
        busy: false,
        indexed: state.total,
        currentPath: null,
        completedAt: Date.now(),
      };
    case 'error': {
      const entry: IndexErrorEntry =
        event.path !== undefined
          ? { path: event.path, message: event.message }
          : { message: event.message };
      const last = state.errors[state.errors.length - 1];
      if (last?.message === entry.message && last.path === entry.path) {
        return state;
      }
      return { ...state, errors: [...state.errors, entry] };
    }
    case 'dirty':
      return { ...state, dirty: event.count };
  }
}

function pickVariant(
  hasIndex: boolean,
  progress: IndexProgressSnapshot,
  showComplete: boolean,
): IndexBlockVariant | null {
  if (progress.busy) return 'indexing';
  if (progress.errors.length > 0) return 'errors';
  if (!hasIndex) return 'not-indexed';
  if (progress.dirty > 0) return 'dirty';
  if (showComplete) return 'complete';
  return null;
}

function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function IndexStatusBlock(props: IndexStatusBlockProps): JSX.Element | null {
  const source = props.source ?? EMPTY_SOURCE;
  const liveHasIndex = useSyncExternalStore<boolean>(
    source.subscribe,
    source.hasIndex,
    source.hasIndex,
  );
  const hasIndex = props.hasIndexOverride ?? liveHasIndex;

  const [livePrg, dispatch] = useReducer(reduce, INITIAL_PROGRESS);
  const progress = props.progressOverride ?? livePrg;

  useEffect(() => {
    const sub = props.drainSubscribe;
    if (sub === undefined) return;
    return sub((event) => dispatch(event));
  }, [props.drainSubscribe]);

  const completeToastMs = props.completeToastMs ?? DEFAULT_COMPLETE_TOAST_MS;
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (progress.completedAt === null) return;
    if (progress.errors.length > 0 || progress.dirty > 0) return;
    const elapsed = Date.now() - progress.completedAt;
    if (elapsed >= completeToastMs) return;
    const handle = setTimeout(() => setNow(Date.now()), completeToastMs - elapsed);
    return () => clearTimeout(handle);
  }, [progress.completedAt, progress.errors.length, progress.dirty, completeToastMs]);

  const showComplete =
    progress.completedAt !== null && now - progress.completedAt < completeToastMs;

  const variant = pickVariant(hasIndex, progress, showComplete);

  const pct = useMemo<number>(() => {
    if (progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.indexed / progress.total) * 100));
  }, [progress.indexed, progress.total]);

  if (variant === null) return null;
  const VARIANT_TO_TONE: Record<IndexBlockVariant, string> = {
    errors: 'error',
    complete: 'success',
    indexing: 'progress',
    'not-indexed': 'info',
    dirty: 'info',
  };
  const tone = VARIANT_TO_TONE[variant];

  return (
    <aside
      className={`leo-info-block leo-info-block-${tone} leo-index-status-block`}
      role="status"
      aria-live="polite"
      data-region="index-status-block"
      data-variant={variant}
    >
      <Body
        variant={variant}
        progress={progress}
        pct={pct}
        onReindexAll={props.onReindexAll}
        onReindexChanged={props.onReindexChanged}
      />
    </aside>
  );
}

interface BodyProps {
  readonly variant: IndexBlockVariant;
  readonly progress: IndexProgressSnapshot;
  readonly pct: number;
  readonly onReindexAll?: () => void;
  readonly onReindexChanged?: () => void;
}

function Body(props: BodyProps): JSX.Element {
  if (props.variant === 'not-indexed') {
    return (
      <>
        <p className="leo-info-block-text">Your vault isn&apos;t indexed yet.</p>
        <div className="leo-info-block-actions">
          <button
            type="button"
            className="leo-info-block-button"
            data-slot="index-block-button-index"
            onClick={() => props.onReindexAll?.()}
          >
            Index vault
          </button>
        </div>
      </>
    );
  }

  if (props.variant === 'dirty') {
    const n = props.progress.dirty;
    return (
      <>
        <p className="leo-info-block-text">
          {n} {pluralize(n, 'note', 'notes')} changed since last full index.
        </p>
        <div className="leo-info-block-actions">
          <button
            type="button"
            className="leo-info-block-button"
            data-slot="index-block-button-reindex-changed"
            onClick={() => props.onReindexChanged?.()}
          >
            Reindex changed
          </button>
          <button
            type="button"
            className="leo-info-block-button leo-info-block-button-secondary"
            data-slot="index-block-button-reindex-all"
            onClick={() => props.onReindexAll?.()}
          >
            Reindex all
          </button>
        </div>
      </>
    );
  }

  if (props.variant === 'indexing') {
    const { indexed, total, currentPath, errors } = props.progress;
    return (
      <>
        <div className="leo-info-block-head">
          <p className="leo-info-block-text">
            Indexing {indexed.toLocaleString('en-US')} / {total.toLocaleString('en-US')}{' '}
            {pluralize(total, 'note', 'notes')}…
          </p>
          <span className="leo-info-block-pct" aria-hidden="true">
            {props.pct}%
          </span>
        </div>
        <div
          className="leo-info-block-progress"
          // NOSONAR S6819 — custom-styled bar with inner fill; native <progress> can't be styled consistently across Electron
          role="progressbar"
          aria-valuenow={props.pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Index progress"
        >
          <span className="leo-info-block-progress-fill" style={{ width: `${props.pct}%` }} />
        </div>
        {currentPath !== null ? (
          <p className="leo-info-block-subtext" data-slot="index-block-current">
            {currentPath}
          </p>
        ) : null}
        {errors.length > 0 ? (
          <p className="leo-info-block-subtext leo-info-block-error-count">
            {errors.length} {pluralize(errors.length, 'error', 'errors')} so far
          </p>
        ) : null}
      </>
    );
  }

  if (props.variant === 'errors') {
    const { errors } = props.progress;
    const pathErrors = errors.filter((e) => e.path !== undefined && e.path.length > 0);
    const generalErrors = errors.filter((e) => e.path === undefined || e.path.length === 0);
    const sample = pathErrors.slice(0, 3);
    const headline =
      pathErrors.length > 0
        ? `Failed to index ${pathErrors.length} ${pluralize(pathErrors.length, 'note', 'notes')}.`
        : (generalErrors[generalErrors.length - 1]?.message ?? 'Indexing could not start.');
    return (
      <>
        <p className="leo-info-block-text">{headline}</p>
        {pathErrors.length > 0 ? (
          <ul className="leo-info-block-error-list">
            {sample.map((e) => (
              <li key={e.path}>
                <span className="leo-info-block-error-path">{e.path}</span>
                <span className="leo-info-block-error-msg"> — {e.message}</span>
              </li>
            ))}
            {pathErrors.length > sample.length ? (
              <li className="leo-info-block-error-more">
                … and {pathErrors.length - sample.length} more
              </li>
            ) : null}
          </ul>
        ) : null}
        <div className="leo-info-block-actions">
          <button
            type="button"
            className="leo-info-block-button"
            data-slot="index-block-button-retry"
            onClick={() => props.onReindexChanged?.()}
          >
            Retry
          </button>
          <button
            type="button"
            className="leo-info-block-button leo-info-block-button-secondary"
            data-slot="index-block-button-reindex-all"
            onClick={() => props.onReindexAll?.()}
          >
            Reindex all
          </button>
        </div>
      </>
    );
  }

  // complete
  return (
    <p className="leo-info-block-text" data-slot="index-block-complete">
      Indexed {props.progress.total.toLocaleString('en-US')}{' '}
      {pluralize(props.progress.total, 'note', 'notes')}.
    </p>
  );
}
