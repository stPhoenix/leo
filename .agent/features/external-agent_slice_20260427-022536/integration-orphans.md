# Integration orphans — external-agent_slice_20260427-022536

2026-04-27T14:13:00+03:00

The following modules shipped and PASSed per-feature compliance but are not directly referenced from any declared entry point. The audit is best-effort one-hop and does not follow full transitive imports — most "orphans" below are still reachable through their importers, which themselves are wired into the entry point.

Entry points scanned:
- src/main.ts

| Feature | File | Exported symbols | Notes |
|---|---|---|---|
| F13 logging-bundle | src/agent/externalAgent/loggingNamespaces.ts | EXTERNAL_AGENT_LOG, SENSITIVE_FIELD_KEYS | True orphan by design — module is a documentation/discoverability surface for adapters and the lint-test target. Logger call sites use the literal event strings (which match the constants) directly. No wiring bullet in F13 scope. |
| F08 widget-ui | src/ui/chat/blocks/ExternalAgentWidget.tsx | ExternalAgentWidget, ExternalAgentWidgetProps | Transitively reachable: imported by `ExternalAgentLiveBlock.tsx` (registered in main.ts via `registerWidget(EXTERNAL_AGENT_LIVE_KIND, ...)`). |
| F11 settings-ui | src/settings/ExternalAgentsSection.tsx | ExternalAgentsSection, ExternalAgentsSectionProps | Transitively reachable: imported by `SettingsTab.ts` which is constructed in `src/main.ts:627`. |
| F08 / F11 | *.stories.tsx | (Storybook fixtures) | Non-runtime targets; consumed by Storybook only. |

## Resolution

- `loggingNamespaces.ts` — intentional. Keep for adapter/maintainer reference + lint policy declaration.
- `ExternalAgentWidget.tsx` and `ExternalAgentsSection.tsx` — transitively reachable; no action required.
- Storybook stories — out of scope for runtime integration.

No true orphans require remediation. The audit scan limitation (one-hop only) over-reports modules that are reachable through ordinary import chains.
