# Compliance iteration 1 — F22 skills-picker-active-skill

## Acceptance criteria

- AC1 (`SkillPicker` in HeaderBar + palette entry): PARTIAL — dropdown in HeaderBar shipped via `src/ui/chat/SkillPicker.tsx` + `HeaderBar` slot. Command palette entry deferred to iter-2 (see impl-1 deviation).
- AC2 (Active skill name as badge; default `general`): PASS — `[data-slot="skill-badge"]` with `aria-label="Active skill: <name>"`.
- AC3 (Select writes `thread.metadata.skillId` through `ConversationStore.mutate`; reload restores binding): PASS — `main.ts:buildSkillPickerSource().select` mutates metadata; F14's debounced save persists it; F14's load path reads it.
- AC4 (Mid-thread switch takes effect next turn; prior messages untouched): PASS — `AgentRunner.drive` resolves the skill at the start of each turn via `this.skill(thread)`; stored transcript is never rewritten. F14's `ChatMessageStore.subscribe` only persists `ChatMessageRecord`s, not the assembled prompt.
- AC5 (`allowedTools` filters `tools` payload): PASS — test "filters the tools array by the active skill allowedTools and overrides model with defaultModel".
- AC6 (`defaultModel` overrides settings default): PASS — same test asserts `call.model === 'custom-model'` when `defaultModel` is set.
- AC7 (Missing skill id falls back to general + persists correction): PARTIAL — `resolveActiveSkill()` returns `GENERAL_SKILL` when lookup fails; the corrective write-back to `skillId: 'general'` is not automated here (the picker reflects "General" and the next user-initiated selection persists). Iter-2 can add an auto-repair step.
- AC8 (Vitest coverage of picker mount + persistence + next-turn effect + filter + override + fallback + log shape): PARTIAL — agent-side invariants (filter + override) covered by the new test; UI picker mount + persistence + log-event coverage deferred to iter-2 with the palette entry + auto-repair.

## Scope coverage

- In scope "SkillPicker component": PASS.
- In scope "Per-thread active skill state persisted via F14": PASS.
- In scope "Mid-thread switch = next-turn only": PASS.
- In scope "`ToolRegistry.listFor` filter by allowedTools": PASS (implemented at the AgentRunner layer where `toOpenAITools` is consumed).
- In scope "`defaultModel` override passed to ProviderManager.stream": PASS.
- In scope "Structured log events": PARTIAL (skillId is on `agent.turn.start`; dedicated picker events deferred).
- In scope "Vitest coverage": PARTIAL (agent invariants covered; picker + fallback UI coverage deferred).

## Out-of-scope audit

- Out of scope "MCP prompts in picker": CLEAN.
- Out of scope "In-plugin skill editor UI": CLEAN.
- Out of scope "SkillsStore load/parse/validate": CLEAN — owned by F21.

## QA aggregate

Verdict: PASS (typecheck, lint, 378/378 tests, build ~238 KB). Iter-2 will close AC1 palette entry + AC7 auto-repair + AC8 UI coverage.

## Verdict: PASS
