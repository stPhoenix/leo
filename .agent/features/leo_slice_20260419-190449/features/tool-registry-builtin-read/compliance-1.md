# Compliance iteration 1 — F16 tool-registry-builtin-read

## Acceptance criteria

- AC1 (`ToolRegistry.register(spec)` accepts spec; duplicate ids throw; `listFor` returns full registry; `lookup` returns spec or undefined): PASS — `src/tools/toolRegistry.ts:14-36`; duplicate-id throw at `:15`; pass-through `listFor` at `:26`; `lookup` at `:22`. Tests: `tests/unit/toolRegistry.test.ts` "registers a tool and lookups return the spec; listFor returns full list", "rejects duplicate ids", "returns undefined for unknown lookups".
- AC2 (`AgentRunner` serialises `listFor(thread)` into OpenAI `tools` array `{type:"function", function:{name, description, parameters}}`; omitted when empty): PASS — `ToolRegistry.toOpenAITools` at `src/tools/toolRegistry.ts:30-39`; `AgentRunner.drive` includes `tools` only when `tools.length > 0` at `src/agent/agentRunner.ts:227-231`. Tests: `toolRegistry.test.ts` "serialises every spec as {type:\"function\", function:{name, description, parameters}}" + `agentRunner.test.ts` "passes the OpenAI tools array to the provider when the registry has tools, omits when empty".
- AC3 (provider `tool_call` → `ToolRegistry.invoke` → `tool_result` fed back → resume; strict serial order): PASS — `src/agent/agentRunner.ts:240-306`: per iteration collects `tool_call` events, invokes each serially via `toolRegistry.invoke`, appends `role:'tool'` messages to `workingMessages`, then re-enters the loop. Second tool call only starts after the first tool result is appended. Test: `agentRunner.test.ts` "drives the provider through a serial tool_call → tool_result → tokens round trip".
- AC4 (`read_note` registered at onload with `requiresConfirmation: false`, Zod-like `{path: string}`, invokes `VaultAdapter.read`, returns `{ok:true, data:{path, content}}`): PASS — registration in `src/main.ts:103-107`; tool shape asserted at `tests/unit/readNoteTool.test.ts` "declares id, description, JSON-schema params, and requiresConfirmation=false"; happy path at "happy path reads content via VaultAdapter.read".
- AC5 (rejects traversal-unsafe paths before touching the vault; returns `{ok:false}` on missing file; no exception escapes): PASS — `src/tools/readNoteTool.ts:27-42` runs `isSafeVaultPath` in `validate` (before `invoke` runs); `invoke` wraps vault calls in `try/catch` and returns `{ok:false}` on any throw. Tests: "rejects traversal-unsafe paths during validate before touching the vault", "returns {ok:false} when the file does not exist; no exception escapes", plus the `isSafeVaultPath` boundary suite.
- AC6 (structured `tool.register` + `tool.invoke.start/ok/error` with `toolId`, `thread`, `durationMs`; content not logged verbatim): PASS — `src/tools/toolRegistry.ts:17-21` emits `tool.register`; `:58-95` emits `tool.invoke.start` / `.ok` / `.error` with `{toolId, thread, durationMs}`; `invoke` never logs `result.data.content`. `read_note.invoke` returns the content but the registry only logs the outcome keys.
- AC7 (Vitest covers duplicate-id rejection, JSON-Schema serialisation, empty-registry omission, serial call ordering, read_note happy + missing + traversal): PASS — see cited tests above.

## Scope coverage

- In scope "`ToolRegistry` module with register / listFor / lookup / invoke": PASS — AC1.
- In scope "Declarative ToolSpec schema (name, description, parameters, requiresConfirmation, invoke)": PASS — `src/tools/types.ts`.
- In scope "OpenAI-compatible tools parameter wiring at prompt-build time": PASS — AC2.
- In scope "Serial tool-call loop integration in AgentRunner turn loop": PASS — AC3.
- In scope "Built-in read-only `read_note` via `VaultAdapter.read`": PASS — AC4.
- In scope "Bootstrap registration at Plugin.onload": PASS — `src/main.ts:103-107`.
- In scope "Structured log events + Vitest coverage": PASS — AC6 / AC7.

## Out-of-scope audit

- Out of scope "Inline tool-confirmation flow (pause, prompt, allow-once/thread/deny)": CLEAN — no `tool_confirmation` branch in `AgentRunner.drive`; `requiresConfirmation: true` tools would invoke directly at this stage. F17 will add the pause.
- Out of scope "Write tools (`create_note`, `append_to_note`)": CLEAN — only `read_note` is registered.
- Out of scope "`edit_note` with CM6 lock": CLEAN — no `EditorBridge` mutation code added.
- Out of scope "Skill `allowedTools` filtering": CLEAN — `listFor(thread)` is a pass-through; no filter predicate wired.
- Out of scope "MCP-sourced tools + namespace": CLEAN — no MCP imports; `ToolSource` includes `'mcp'` but only `'builtin'` is registered.

## QA aggregate

Verdict: PASS (typecheck, lint, 309/309 tests, build ~216 KB).

## Verdict: PASS
