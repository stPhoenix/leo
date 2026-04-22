import { useEffect, useState, useSyncExternalStore } from 'react';
import type { DrainListener } from '@/indexer/vaultIndexer';

export interface IndexStatusSource {
  readonly hasIndex: () => boolean;
  readonly subscribe: (cb: () => void) => () => void;
}

export interface IndexEmptyStateCtaProps {
  readonly source?: IndexStatusSource;
  readonly onIndexVault?: () => void;
  readonly drainSubscribe?: (listener: DrainListener) => () => void;
}

const EMPTY_SOURCE: IndexStatusSource = {
  hasIndex: () => true,
  subscribe: () => () => undefined,
};

export function IndexEmptyStateCta(props: IndexEmptyStateCtaProps): JSX.Element | null {
  const source = props.source ?? EMPTY_SOURCE;
  const hasIndex = useSyncExternalStore<boolean>(
    source.subscribe,
    source.hasIndex,
    source.hasIndex,
  );
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    const sub = props.drainSubscribe;
    if (sub === undefined) return;
    const off = sub((event) => {
      if (event.kind === 'complete') setDismissed(true);
    });
    return off;
  }, [props.drainSubscribe]);

  if (hasIndex || dismissed) return null;

  return (
    <div
      className="leo-index-empty-cta"
      role="note"
      aria-label="Vault not indexed"
      data-region="index-empty-cta"
    >
      <p className="leo-index-empty-cta-text">Your vault isn&apos;t indexed yet.</p>
      <button
        type="button"
        className="leo-index-empty-cta-button"
        data-slot="index-empty-cta-button"
        onClick={() => props.onIndexVault?.()}
      >
        Index vault
      </button>
    </div>
  );
}
