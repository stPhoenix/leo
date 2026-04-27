# Compliance iteration 1 — F09 tool-publish-artifact

## Acceptance criteria
- AC1 (buffers; nothing crosses sandbox boundary at nomination): PASS — `publishArtifact.test.ts` "buffers nominations without writing past the sandbox" + "path-escape rejected".
- AC2 (count cap → artifact_limit): PASS — "count cap → artifact_limit" with `maxArtifacts: 2`.
- AC3 (duplicate + not_found): PASS — "duplicate / non-existent rejection".
- AC4 (one file event per nomination, in order): PASS — "emits one file event per nominated artifact in order" + assertion of MIME inference.
- AC5 (missing artifact at flush → warn + skip; run continues): PASS — "missing artifact at flush → warn log + skip".
- AC6 (partial flush on iteration_limit): PASS by composition — `flushPublishedArtifacts` is a pure generator that the F12 simple-branch + F15 synthesize will call regardless of whether the run terminated cleanly or hit `iteration_limit`. F12 owns the actual wiring; the helper itself does not gate on terminal status.
- AC7 (path-prefix safety at nomination AND flush): PASS — "nomination present at nomination time, deleted before flush → warn skip" exercises the flush-time recheck via `sandbox.checkSafe`.

## Scope coverage
- In scope "schemas.ts publish_artifact subset": PASS — `tools/schemas.ts` (added in F06 slice).
- In scope "publishArtifact.ts": PASS.
- In scope "artifactFlush.ts": PASS.
- In scope "Adapter wiring in start()": deferred to F12/F16 (the helper is composable; per impl-1.md note, the flush is invoked from there).
- In scope "Unit tests": PASS — 18 cases.

## Out-of-scope audit
- Out of scope "Tool callable from researchStep": CLEAN — no allow-list change here; F14 will explicitly omit the tool when assembling that branch's tool list.
- Out of scope "ResultWriter writing externalAgentResults": CLEAN — host module unchanged.
- Out of scope "Cross-run artifact reuse": CLEAN.

## QA aggregate
`qa-1.md` verdict PASS — 1750/1750, lint/typecheck/build green.

## Verdict: PASS
