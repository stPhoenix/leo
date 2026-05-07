import type { ProviderKind } from '@/settings/settingsStore';

export type IngestSourceKind = 'url' | 'vaultPath' | 'attachment' | 'conversation' | 'inbox';

/**
 * Per-call provider+model override for wiki workflows. Endpoint, API key,
 * temperature always inherit from current global settings.
 */
export interface ProviderOverride {
  readonly providerId: ProviderKind;
  readonly model: string;
}

export type IngestSource =
  | { readonly kind: 'url'; readonly url: string; readonly note?: string }
  | { readonly kind: 'vaultPath'; readonly path: string; readonly note?: string }
  | { readonly kind: 'attachment'; readonly attachmentId: string; readonly note?: string }
  | {
      readonly kind: 'conversation';
      readonly title: string;
      readonly body: string;
      readonly citedSources?: readonly string[];
      readonly note?: string;
      readonly threadId: string;
      readonly turnIndex: number;
    }
  | { readonly kind: 'inbox' };

export interface FetchedSource {
  readonly sourceRef: string;
  readonly originalPath: string | null;
  readonly contentType: string;
  readonly body: string;
  readonly bytes: number;
}

export interface FetchError {
  readonly code:
    | 'fetch_blocked'
    | 'fetch_timeout'
    | 'fetch_too_large'
    | 'fetch_http_error'
    | 'fetch_invalid_url'
    | 'fetch_failed'
    | 'fetch_attachment_missing'
    | 'fetch_vault_missing'
    | 'fetch_vault_not_file';
  readonly message: string;
}

export type FetchResult =
  | { readonly ok: true; readonly fetched: FetchedSource }
  | { readonly ok: false; readonly error: FetchError };

export interface RawWritePayload {
  readonly fetched: FetchedSource;
  readonly fetchedAt: string;
  readonly sha256: string;
  readonly slugLabel: string;
  readonly nowDate: Date;
}

export interface PersistedRaw {
  readonly rawPath: string;
  readonly sha256: string;
  readonly fetchedAt: string;
  readonly bytes: number;
}

export type DuplicateChoice = 'skip' | 'reprocess' | 'replace';

export interface DuplicateMatch {
  readonly rawPath: string;
  readonly sha256: string;
  readonly fetchedAt: string;
}

export interface SourceTerminalRecord {
  readonly sourceRef: string;
  readonly status: 'persisted' | 'replaced' | 'skipped' | 'reprocessed' | 'error';
  readonly rawPath: string | null;
  readonly error?: string;
}
