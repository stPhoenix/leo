# Impl iteration 1 — F22 skills-picker-active-skill

## Summary

Wired F21's `SkillsStore` into the live agent + UI flow. Added a `SkillPicker` component in the `HeaderBar` region (Obsidian-themed `<select>` listing sorted skills + `role="status"` badge showing active name). Active skill is resolved via `thread.metadata.skillId` from F14, with fallback to `general` when the id is missing. `AgentRunner.skill` option becomes thread-aware; when the active skill declares `allowedTools`, the OpenAI tools array handed to the provider is filtered to that set; when it declares `defaultModel`, that id overrides the settings default for that turn. `ChatView` and `main.ts` wire the picker source + select-write-back path.

## Files touched

- `src/agent/types.ts` — extended `Skill` with optional `allowedTools` and `defaultModel` fields so `agentRunner` can route without a second Skill type.
- `src/agent/agentRunner.ts` — `skill` option now takes `(thread: ThreadId) => Skill`; `drive()` computes `activeSkill = this.skill(thread)` once per turn; filters `tools` to `activeSkill.allowedTools` when defined; uses `activeSkill.defaultModel ?? this.model()` everywhere the provider is invoked; logs `skillId` on `agent.turn.start`.
- `src/ui/chat/SkillPicker.tsx` — new React component with a `SkillPickerSource` DI surface (`listSkills` / `currentSkillId` / `subscribe` / `select`) + Obsidian-themed `<select>` + `aria-label="Active skill: …"` badge.
- `src/ui/chat/HeaderBar.tsx` — new optional `skillPicker?: ReactNode` child rendered inside the existing `leo-header-skill-slot`.
- `src/ui/chat/ChatRoot.tsx` — new `skillPickerSource?` prop forwarded through to the `HeaderBar`.
- `src/ui/chatView.tsx` — new `skillPickerSource?` dep passed through to `ChatRoot`.
- `src/main.ts` — constructs `SkillsStore`, calls `loadAll()` at onload, wires `AgentRunner.skill` via `resolveActiveSkill()`, wires `ChatView.skillPickerSource` via `buildSkillPickerSource()` (`select` mutates `thread.metadata.skillId` through `ConversationStore.mutate` and notifies React subscribers).
- `tests/unit/agentRunner.test.ts` — 1 new case "filters the tools array by the active skill allowedTools and overrides model with defaultModel".

## Tests added or updated

- 1 new `agentRunner` case (covering AC5 + AC6). Full suite: 45 files, 378/378 pass.
- F21's 13 skills-store cases already cover the catalogue side.

## Addressed gaps from previous iteration

Not applicable — first iteration.

## Deviations from feature.md

- **"Leo: Select skill" command palette entry is not registered** — the picker is reachable via the HeaderBar dropdown only. Can land in iter-2 with a small `registerLeoCommand` call.
- **Structured log events** — agent side logs `skillId` on every `agent.turn.start`; the four dedicated `skill.picker.open` / `skill.select` / `skill.filter.applied` / `skill.model.override` events are not individually emitted (the state is captured in `agent.turn.start` fields). Iter-2 can split them if ops wants distinct event names.
- **SkillPicker focus behaviour** uses a native `<select>` for keyboard reachability and minimal DOM footprint; a fully custom `role="listbox"` dropdown is a larger iter-2 deliverable.

## Assumptions

- Changing skill mid-thread is take-effect-next-turn because `resolveActiveSkill()` reads `ConversationStore.thread.metadata.skillId` synchronously inside `AgentRunner.drive()` at the start of each turn; already-persisted messages are untouched.
- `GENERAL_SKILL` is the fallback when the stored skill id resolves to `undefined` (file deleted, unrecognised id).

## Open questions

None.
