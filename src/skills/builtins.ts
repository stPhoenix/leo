import type { InvocationContext, InvocationMessage, InvocationResult, Skill } from './types';
import { applySubstitutions } from './substitutions';

interface BuiltinBlueprint {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly argumentHint?: string;
  readonly allowedTools: readonly string[];
  readonly userInvocable: boolean;
  readonly disableModelInvocation: boolean;
  readonly body: string;
}

function buildBuiltinSkill(bp: BuiltinBlueprint): Skill {
  const path = `plugin://skills/${bp.name}`;
  return {
    type: 'prompt',
    name: bp.name,
    displayName: bp.displayName,
    description: bp.description,
    ...(bp.whenToUse !== undefined ? { whenToUse: bp.whenToUse } : {}),
    ...(bp.argumentHint !== undefined ? { argumentHint: bp.argumentHint } : {}),
    allowedTools: bp.allowedTools,
    disableModelInvocation: bp.disableModelInvocation,
    userInvocable: bp.userInvocable,
    source: 'plugin',
    loadedFrom: 'plugin',
    contentLength: bp.body.length,
    isHidden: !bp.userInvocable,
    async getPromptForCommand(args: string, ctx: InvocationContext): Promise<InvocationResult> {
      const finalContent = applySubstitutions({ body: bp.body, args, ctx });
      const messages: InvocationMessage[] = [
        {
          role: 'user',
          content: finalContent,
          marker: `<command-name>${bp.name}</command-name>`,
        },
      ];
      return { messages, finalContent, path };
    },
  };
}

const CANVAS_CREATE_BODY = `# canvas-create — research, refine, then delegate

User asked: "$ARGUMENTS"

You are preparing a high-quality \`delegate_canvas_create\` invocation. The downstream tool runs an expensive multi-phase pipeline (refine → fetch → extract → reduce → layout → preview → write) over the sources you specify. Garbage in = garbage out. Your job is to gather context first, design a tight run plan, get user approval, then delegate.

Follow these steps in order. Do not skip any.

## Step 1 — Enter plan mode
Call \`EnterPlanMode\` immediately, before any other tool. The rest of this workflow runs read-only inside plan mode.

## Step 2 — Inventory what the user already named
Re-read the user ask above. Extract:
- Explicit \`@\`-mentions and bare vault paths → read each with \`read_note\` (or \`read_file\` for non-markdown).
- Explicit URLs → list them; you will pass them through as \`url\` source hints (do not fetch).
- Explicit \`#tag\` mentions or frontmatter filters.
- Folder hints ("notes about X", "the project Y folder") → use \`list_notes\` / \`glob_vault\` to enumerate and \`read_note\` the obvious anchor files.

If the user named nothing concrete, treat the ask as a topic and proceed to Step 3.

## Step 3 — Discover related material
Use the tools below to find what already exists in the vault about the topic. Run multiple parallel queries — do not single-thread.

- \`search_vault\` — RAG semantic search for the topic and its key terms.
- \`grep_vault\` — keyword/regex sweeps for proper nouns, IDs, terms-of-art the user mentioned.
- \`glob_vault\` — by extension or folder when the topic implies a layout.
- \`search_wiki\` — query the structured wiki index for entities/relations on the topic.

Skim hits, read the most relevant 3–6 with \`read_note\`. Stop when you have a clear picture of available sources, not when you have read everything.

## Step 4 — Clarify only if necessary
Use \`AskUserQuestion\` ONLY for ambiguity that will materially change the canvas:
- The topic is too broad to bound (offer 2–4 narrower scopes).
- Conflicting candidate datasets (offer the user the choice).
- Layout is non-obvious AND the user did not specify (offer presets).

Do NOT ask cosmetic questions ("what title?"), and do NOT ask if you can answer from the gathered context.

## Step 5 — Draft the run plan
Produce, in your own working text, a concrete plan with these sections:

\`\`\`
Outcome: <one sentence describing what the canvas will show>
Entity types: <2–6 lowercase singular names with one-line descriptions>
Relation types: <0–8 named relations between entity types, with from/to>
Source hints: <concrete list — vault paths, globs, tags, frontmatter filters, URLs, attachments>
Layout: <one of: bipartite | tree | radial | force | grid | timeline | auto>
Target path: <vault-relative .canvas path, or "auto">
\`\`\`

The source hints MUST be specific. Globs like \`**/*.md\` are forbidden — they fan out the entire vault and burn an extractor LLM call per file. Prefer:
- \`{ kind: "mention", path: "<exact path>" }\` for known files.
- \`{ kind: "vaultGlob", glob: "<folder>/**/*.md" }\` only when the folder is small and bounded.
- \`{ kind: "vaultTag", tag: "<tag>" }\` when a tag scopes the set.
- \`{ kind: "url", url: "<https://…>" }\` for external pages the user named.
- \`{ kind: "vaultFrontmatter", field: "type", value: "project" }\` for typed notes.

## Step 6 — Present plan, get approval
Call \`ExitPlanMode\` with a markdown plan body containing:
- The Outcome line.
- A short bullet list of the entity types and relation types you will request.
- The exact source-hint list (file paths, tags, URLs).
- The chosen layout preset and target path.
- A one-line "Press Approve to invoke delegate_canvas_create" footer.

Wait for user approval. If the user edits the plan, re-read the edited plan file before continuing.

## Step 7 — Invoke delegate_canvas_create
Compose the \`ask\` argument as a self-contained brief that the refine sub-agent can turn into a RunPlan without further questions. It must include:
- The outcome.
- The exact entity-type and relation-type names + descriptions.
- The exact source list (paths/tags/URLs verbatim — no globs).
- The layout preset (use \`layoutAlgo\` arg, NOT a free-form layout name in the ask).
- The target path (use \`targetPath\` arg).

Call \`delegate_canvas_create\` once. Do not retry on first error — surface it to the user with the original error message so they can decide.

## Notes
- You are running with a restricted tool allowlist. Do not attempt write or edit tools — they will be denied.
- Plan mode also blocks \`delegate_canvas_create\`; that is intentional — it runs only after you exit plan mode and the user approves.
- If you cannot find any concrete sources after Step 3 and Step 4, abort with a message explaining why; do not invoke \`delegate_canvas_create\` with an empty source list.
`;

const CANVAS_CREATE_SKILL: Skill = buildBuiltinSkill({
  name: 'canvas-create',
  displayName: 'canvas-create',
  description: 'Research vault context, draft a run plan, then invoke delegate_canvas_create',
  whenToUse:
    'When the user wants to build an Obsidian canvas from notes, URLs, or this conversation. Drives the pre-flight workflow before delegate_canvas_create.',
  argumentHint: '<topic or description of the canvas>',
  allowedTools: [
    'read_note',
    'read_file',
    'list_notes',
    'search_vault',
    'grep_vault',
    'glob_vault',
    'search_wiki',
    'open_note',
    'reveal_in_note',
    'AskUserQuestion',
    'EnterPlanMode',
    'ExitPlanMode',
    'TodoWrite',
    'delegate_canvas_create',
  ],
  userInvocable: true,
  disableModelInvocation: true,
  body: CANVAS_CREATE_BODY,
});

const CANVAS_CONTENT_EDIT_BODY = `# canvas-content-edit — read, plan delta, then delegate

User asked: "$ARGUMENTS"

You are preparing a high-quality \`delegate_canvas_content_edit\` invocation. The downstream tool runs the same expensive multi-phase pipeline as create (refine → fetch → extract → reduce → diff → layout → preview → write) over an existing \`.canvas\`. Garbage in = garbage out. Your job is to read the current canvas + sidecar, surface tombstones, gather any new sources, design a tight delta plan, get user approval, then delegate.

Follow these steps in order. Do not skip any.

## Step 1 — Enter plan mode
Call \`EnterPlanMode\` immediately, before any other tool. The rest of this workflow runs read-only inside plan mode.

## Step 2 — Resolve the target canvas path
Re-read the user ask. If it names an explicit \`.canvas\` path, use that. Otherwise:
- Run \`glob_vault\` for \`**/*.canvas\`.
- If exactly one match exists, use it.
- If multiple, present up to 4 candidates via \`AskUserQuestion\` and let the user pick.
- If zero, abort with a message — there is nothing to edit.

The path MUST end in \`.canvas\` and live inside the vault.

## Step 3 — Read the current canvas + sidecar
- \`read_file\` on \`<path>\` — the canvas JSON. Note existing nodes and their ids/labels.
- \`read_file\` on \`<path>.sidecar.json\` — the sidecar.
- If sidecar is missing or unreadable, abort and tell the user to run \`delegate_canvas_create\` first or repair the sidecar; \`delegate_canvas_content_edit\` requires a sidecar.

From the sidecar (\`SidecarV1\`), extract:
- \`schema.entityTypes[]\` — existing entity-type names + descriptions.
- \`schema.relationTypes[]\` — existing relation-type names with from/to.
- \`coordMap\` — locked node coordinates (the diff pipeline preserves these; manual layout is kept).
- \`tombstones\` — ids of previously deleted entities.
- \`edgeTombstones\` — previously deleted edges.

## Step 4 — Inspect tombstones
Refine treats tombstones as "do not re-emit unless the new instruction explicitly requests them." Walk the tombstones and check whether any overlap the user's instruction.

If the edit asks (or implies) re-adding a tombstoned entity, call this out verbatim in the plan with the entity name + id. The \`instruction\` you pass downstream MUST explicitly say "re-add <name>" so refine is allowed to emit it again.

## Step 5 — Inventory user mentions
Extract from the ask:
- Explicit \`@\`-mentions and bare vault paths → read each with \`read_note\` (or \`read_file\` for non-markdown).
- Explicit URLs → list as \`url\` source hints (do not fetch).
- Explicit \`#tag\` mentions or frontmatter filters.

## Step 6 — Discover new material (only if adding entities/relations)
Skip this step entirely when the edit is purely relabel / remove / retype on existing nodes.

When adding new content, run parallel queries:
- \`search_vault\` — RAG semantic search for the new terms.
- \`grep_vault\` — keyword/regex sweeps for proper nouns, IDs, terms-of-art the user mentioned.
- \`glob_vault\` — by extension or folder when the addition implies a layout.
- \`search_wiki\` — query the structured wiki index for entities/relations on the topic.

Read the most relevant 3–6 hits with \`read_note\`. Stop when you have a clear picture of available sources.

## Step 7 — Clarify only if necessary
Use \`AskUserQuestion\` ONLY for ambiguity that will materially change the edit:
- Ambiguous target canvas (covered in Step 2).
- Conflicting source candidates for an addition.
- Layout reset (apply a preset) vs preserve sidecar coords AND the user did not specify.

Do NOT ask cosmetic questions, and do NOT ask if you can answer from the gathered context.

## Step 8 — Draft the delta plan
Produce, in your own working text, a concrete delta plan:

\`\`\`
Target: <path>
Existing schema:
  Entity types: <list from sidecar.schema.entityTypes>
  Relation types: <list from sidecar.schema.relationTypes (from → to)>
Edit summary: <add | remove | relabel | retype | mixed>
Adds: <new entities/relations with one-line descriptions, or "none">
Removes: <entity/relation ids by label, or "none">
Relabels/retypes: <id → new label/type, or "none">
Re-adds of tombstoned entities: <list with explicit re-ask, or "none">
New source hints: <concrete list — vault paths, globs, tags, frontmatter filters, URLs>
Layout: <preserve sidecar coords (omit layoutAlgo) | bipartite | tree | radial | force | grid | timeline>
\`\`\`

The new source hints MUST be specific. Globs like \`**/*.md\` are forbidden — they fan out the entire vault and burn an extractor LLM call per file. Prefer:
- \`{ kind: "mention", path: "<exact path>" }\` for known files.
- \`{ kind: "vaultGlob", glob: "<folder>/**/*.md" }\` only when the folder is small and bounded.
- \`{ kind: "vaultTag", tag: "<tag>" }\` when a tag scopes the set.
- \`{ kind: "url", url: "<https://…>" }\` for external pages the user named.
- \`{ kind: "vaultFrontmatter", field: "type", value: "project" }\` for typed notes.

When the edit touches existing content only (no adds), source hints can be empty — refine will operate from the instruction + sidecar.

## Step 9 — Present plan, get approval
Call \`ExitPlanMode\` with a markdown plan body containing:
- The Target line.
- The existing schema (entity/relation types).
- The edit summary + adds/removes/relabels/retypes.
- Any tombstone re-adds, called out explicitly.
- The new source-hint list (paths/tags/URLs).
- The layout decision (preserve vs preset).
- A one-line "Press Approve to invoke delegate_canvas_content_edit" footer.

Wait for user approval. If the user edits the plan, re-read the edited plan file before continuing.

## Step 10 — Invoke delegate_canvas_content_edit
Compose the \`instruction\` argument as a self-contained brief that the refine sub-agent can turn into a RunPlan without further questions. It must include:
- The edit summary in plain English.
- Existing entity/relation types to reuse, named verbatim.
- Any new entity/relation types to add, with descriptions.
- For removes/relabels/retypes: exact ids or labels from the current canvas.
- For tombstone re-adds: explicit "re-add <name>" wording.
- The new source list (paths/tags/URLs verbatim — no globs).
- Use \`path\` arg for the target canvas (the existing one — do NOT pick a new path).
- Pass \`layoutAlgo\` ONLY if the user wants a relayout; omit to preserve sidecar coords.

Call \`delegate_canvas_content_edit\` once. Do not retry on first error — surface it to the user with the original error message so they can decide.

## Notes
- You are running with a restricted tool allowlist. Do not attempt write or edit tools — they will be denied.
- Plan mode also blocks \`delegate_canvas_content_edit\`; that is intentional — it runs only after you exit plan mode and the user approves.
- If the sidecar is missing, abort and tell the user; do not invoke \`delegate_canvas_content_edit\`.
- For pure layout changes (no schema/content delta), prefer \`delegate_canvas_layout_edit\` instead — it skips the expensive extract/reduce/diff phases.
`;

const CANVAS_CONTENT_EDIT_SKILL: Skill = buildBuiltinSkill({
  name: 'canvas-content-edit',
  displayName: 'canvas-content-edit',
  description:
    'Read existing canvas + sidecar, draft an edit plan, then invoke delegate_canvas_content_edit',
  whenToUse:
    'When the user wants to modify an existing Obsidian canvas — add/remove/relabel entities or relations. Drives the pre-flight workflow before delegate_canvas_content_edit.',
  argumentHint: '<edit instruction, optionally with target .canvas path>',
  allowedTools: [
    'read_note',
    'read_file',
    'list_notes',
    'search_vault',
    'grep_vault',
    'glob_vault',
    'search_wiki',
    'open_note',
    'reveal_in_note',
    'reveal_in_canvas',
    'AskUserQuestion',
    'EnterPlanMode',
    'ExitPlanMode',
    'TodoWrite',
    'delegate_canvas_content_edit',
  ],
  userInvocable: true,
  disableModelInvocation: true,
  body: CANVAS_CONTENT_EDIT_BODY,
});

export const BUILTIN_SKILLS: readonly Skill[] = [CANVAS_CREATE_SKILL, CANVAS_CONTENT_EDIT_SKILL];
export const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_SKILLS.map((s) => s.name));
