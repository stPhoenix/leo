export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
  readonly estimatedInput?: boolean;
  readonly estimatedOutput?: boolean;
}

export function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export interface TokenUsageInput {
  readonly promptChars: number;
  readonly outputChars: number;
  readonly providerInput?: number;
  readonly providerOutput?: number;
}

export function computeTokenUsage(input: TokenUsageInput): TokenUsage {
  const providerInput = input.providerInput;
  const providerOutput = input.providerOutput;
  const inputTokens = providerInput ?? estimateTokensFromChars(input.promptChars);
  const outputTokens = providerOutput ?? estimateTokensFromChars(input.outputChars);
  const estimatedInput = providerInput === undefined;
  const estimatedOutput = providerOutput === undefined;
  const usage: TokenUsage = {
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens,
    ...(estimatedInput ? { estimatedInput: true } : {}),
    ...(estimatedOutput ? { estimatedOutput: true } : {}),
  };
  return usage;
}
