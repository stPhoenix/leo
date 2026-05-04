/**
 * Canonical Logger event namespaces for the wiki slice.
 *
 * NFR-WIKI-03: every state transition + per-source/per-page event at `debug`
 * under namespaces `wiki.ingest.*` / `wiki.lint.*` / `wiki.search.*`. Errors
 * at `error`. Raw source content and extractor outputs MUST NOT appear above
 * `debug` level (mirrors external-agent SENSITIVE_FIELD_KEYS policy).
 */
export const WIKI_LOG = {
  bootstrap: {
    done: 'wiki.bootstrap.done',
    failed: 'wiki.bootstrap.failed',
  },
  ingest: {
    transition: 'wiki.ingest.subgraph.transition',
    cancelled: 'wiki.ingest.subgraph.cancelled',
    fetch: {
      ok: 'wiki.ingest.fetch.ok',
      failed: 'wiki.ingest.fetch.failed',
    },
    persist: {
      ok: 'wiki.ingest.persist.ok',
      failed: 'wiki.ingest.persist.failed',
      duplicate: 'wiki.ingest.persist.duplicate',
    },
    plan: {
      ok: 'wiki.ingest.plan.ok',
      invalid: 'wiki.ingest.plan.invalid',
    },
    extract: {
      ok: 'wiki.ingest.extract.ok',
      retry: 'wiki.ingest.extract.retry',
      invalid: 'wiki.ingest.extract.invalid',
    },
    reduce: {
      ok: 'wiki.ingest.reduce.ok',
      retry: 'wiki.ingest.reduce.retry',
      invalid: 'wiki.ingest.reduce.invalid',
    },
    write: {
      ok: 'wiki.ingest.write.ok',
      failed: 'wiki.ingest.write.failed',
    },
    tool: {
      busy: 'wiki.ingest.tool.busy',
      denied: 'wiki.ingest.tool.denied',
    },
  },
  lint: {
    transition: 'wiki.lint.subgraph.transition',
    cancelled: 'wiki.lint.subgraph.cancelled',
    scan: {
      ok: 'wiki.lint.scan.ok',
      failed: 'wiki.lint.scan.failed',
    },
    check: {
      ok: 'wiki.lint.check.ok',
      invalid: 'wiki.lint.check.invalid',
    },
    propose: {
      ok: 'wiki.lint.propose.ok',
      findingStart: 'wiki.lint.propose.finding-start',
      findingOk: 'wiki.lint.propose.finding-ok',
      findingInvalid: 'wiki.lint.propose.finding-invalid',
    },
    confirm: {
      accepted: 'wiki.lint.confirm.accepted',
      rejected: 'wiki.lint.confirm.rejected',
    },
    write: {
      ok: 'wiki.lint.write.ok',
      failed: 'wiki.lint.write.failed',
      findingApplied: 'wiki.lint.write.finding-applied',
      findingFailed: 'wiki.lint.write.finding-failed',
      findingSkipped: 'wiki.lint.write.finding-skipped',
    },
    tool: {
      busy: 'wiki.lint.tool.busy',
      denied: 'wiki.lint.tool.denied',
    },
  },
  search: {
    invoked: 'wiki.search.invoked',
    failed: 'wiki.search.failed',
    warning: 'wiki.search.warning',
  },
  mutex: {
    acquired: 'wiki.mutex.acquired',
    released: 'wiki.mutex.released',
    busy: 'wiki.mutex.busy',
  },
  inbox: {
    add: 'wiki.inbox.add',
    tick: 'wiki.inbox.tick',
    annotate: 'wiki.inbox.annotate',
  },
} as const;

/**
 * Field keys carrying user-content. Lint policy must reject any of these
 * appearing in `info|warn|error` log calls (mirrors external-agent pattern).
 */
export const WIKI_SENSITIVE_FIELD_KEYS: readonly string[] = [
  'rawBody',
  'rawContent',
  'fetchedBody',
  'extractorOutput',
  'reducerOutput',
  'plannerOutput',
  'checkerOutput',
  'pageBody',
  'sourceBody',
  'searchSnippet',
  'searchSummary',
  'logBody',
  'introductionBody',
  'schemaBody',
  'inboxLine',
];
