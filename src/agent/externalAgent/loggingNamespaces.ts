/**
 * Canonical Logger event namespaces for the external-agent slice.
 *
 * NFR-EXT-05: every state transition + adapter event logs at `debug`; errors
 * at `error`. Refined-prompt and response content MUST NOT appear in fields
 * above `debug` level — enforced by the lint test in
 * `tests/unit/externalAgent/loggingPolicy.test.ts`.
 */
export const EXTERNAL_AGENT_LOG = {
  subgraph: {
    transition: 'externalAgent.subgraph.transition',
    cancelled: 'externalAgent.subgraph.cancelled',
    listenerFailed: 'externalAgent.subgraph.listener-failed',
    unhandled: 'externalAgent.subgraph.unhandled',
    writeErrorMdFailed: 'externalAgent.subgraph.write-error-md-failed',
  },
  adapter: {
    eventReceived: 'externalAgent.adapter.event-received',
    eventsAfterDone: 'externalAgent.run.events-after-done',
    inlineAgent: {
      configInvalid: 'externalAgent.adapter.inlineAgent.config-invalid',
      sandboxInitFailed: 'externalAgent.adapter.inlineAgent.sandbox.init-failed',
      sandboxCleanupFailed: 'externalAgent.adapter.inlineAgent.sandbox.cleanup-failed',
      sandboxSweepReaddirFailed: 'externalAgent.adapter.inlineAgent.sandbox.sweep-readdir-failed',
      sandboxSweepRmFailed: 'externalAgent.adapter.inlineAgent.sandbox.sweep-rm-failed',
      sandboxSweepFailed: 'externalAgent.adapter.inlineAgent.sandbox.sweep-failed',
      toolStart: 'externalAgent.adapter.inlineAgent.tool.start',
      toolEnd: 'externalAgent.adapter.inlineAgent.tool.end',
      nodeComplete: 'externalAgent.adapter.inlineAgent.node.complete',
      classifierFallback: 'externalAgent.adapter.inlineAgent.router.classify-fallback',
      plannerFallback: 'externalAgent.adapter.inlineAgent.multistep.planner-fallback',
      iterationLimit: 'externalAgent.adapter.inlineAgent.iteration-limit',
      tokenLimit: 'externalAgent.adapter.inlineAgent.token-limit',
      providerInvalid: 'externalAgent.adapter.inlineAgent.provider-invalid',
      apiKeyMissing: 'externalAgent.adapter.inlineAgent.api-key-missing',
    },
  },
  writer: {
    fileFailed: 'externalAgent.write.file-failed',
    invalidPath: 'externalAgent.write.invalid-path',
    errorMdFailed: 'externalAgent.write.error-md-failed',
    folderCollision: 'externalAgent.write.folder-collision',
    mkdirFailed: 'externalAgent.write.mkdir-failed',
    ok: 'externalAgent.write.ok',
  },
  tool: {
    denied: 'externalAgent.delegate.denied',
    busy: 'externalAgent.delegate.busy',
  },
  refine: {
    dualToolCall: 'externalAgent.refine.dual-tool-call',
    promptSoftLimit: 'externalAgent.refine.prompt-soft-limit',
    noToolCall: 'externalAgent.refine.no-tool-call',
  },
  persist: {
    failed: 'externalAgent.persist.failed',
    appendFailed: 'externalAgent.persist.append-failed',
  },
  piiCheck: {
    scanned: 'externalAgent.piiCheck.scanned',
    applied: 'externalAgent.piiCheck.applied',
    hallucinated: 'externalAgent.piiCheck.hallucinated',
    error: 'externalAgent.piiCheck.error',
    skipped: 'externalAgent.piiCheck.skipped',
  },
} as const;

/**
 * Field keys that carry user-content (refined prompt, ask, response body).
 * The lint policy in `tests/unit/externalAgent/loggingPolicy.test.ts` rejects
 * any of these keys appearing in a `info|warn|error` log call's fields object.
 * Adding a new keyword here tightens the policy.
 */
export const SENSITIVE_FIELD_KEYS: readonly string[] = [
  'refinedAsk',
  'refinedPrompt',
  'responseText',
  'textBuffer',
  'originalAsk',
  'clarifyingQuestion',
  'piiSamples',
  'piiDetails',
  'piiText',
  'effectivePrompt',
];
