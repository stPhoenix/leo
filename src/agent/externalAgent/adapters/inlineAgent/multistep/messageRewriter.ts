/**
 * Pure helpers for FR-IA-39 message-history rewriting.
 *
 * The `Message` shape here is intentionally narrow: enough to model the
 * fields the rewriter needs without coupling to a specific LangChain version.
 * F14 adapts its concrete `BaseMessage` array to/from this shape on the
 * boundary.
 */
export interface RewriteMessage {
  readonly role: 'system' | 'human' | 'user' | 'assistant' | 'ai' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
  readonly name?: string;
}

const SYSTEM_ROLES: ReadonlySet<RewriteMessage['role']> = new Set(['system']);
const PRESERVED_NON_SYSTEM_ROLES: ReadonlySet<RewriteMessage['role']> = new Set([
  'human',
  'user',
  'assistant',
  'ai',
]);

/**
 * Walk `messages`. For each tool-result message whose `toolCallId` is in
 * `consumedRefs`, replace its content with the configured stub format. All
 * other messages pass through unchanged. Stable order — never reorders.
 */
export function rewriteConsumedToolResults(
  messages: readonly RewriteMessage[],
  consumedRefs: ReadonlyMap<string, string>,
): RewriteMessage[] {
  const out: RewriteMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId !== undefined) {
      const noteId = consumedRefs.get(m.toolCallId);
      if (noteId !== undefined) {
        out.push({
          role: 'tool',
          toolCallId: m.toolCallId,
          ...(m.name !== undefined ? { name: m.name } : {}),
          content: `[discarded — see note ${noteId}]`,
        });
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

/**
 * Drop every tool / tool-result message at the step boundary so the next
 * step's prompt only sees `system`, `human`/`user`, and assistant text. The
 * caller (F14) splices in `notes` + `scratchpad` summaries separately.
 */
export function dropRawToolMessagesAtStepBoundary(
  messages: readonly RewriteMessage[],
): RewriteMessage[] {
  return messages.filter((m) => SYSTEM_ROLES.has(m.role) || PRESERVED_NON_SYSTEM_ROLES.has(m.role));
}
