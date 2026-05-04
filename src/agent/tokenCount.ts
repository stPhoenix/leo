/**
 * Heuristic `chars/4` token estimator. LangChain `BaseChatModel.getNumTokens()` is
 * accurate but pulls a per-model tokenizer (tiktoken / @xenova/transformers, ~600 KB
 * minified) and would exceed `pnpm check:bundle`. Used only on hot-path budgeting
 * (context assembly, breakdown widgets) where ±15 % accuracy is acceptable.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
