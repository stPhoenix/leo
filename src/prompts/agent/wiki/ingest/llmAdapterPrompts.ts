export function buildToolUseDirective(toolName: string): string {
  return `You MUST respond by calling the \`${toolName}\` tool exactly once. Do NOT reply with prose, JSON in text, markdown, code blocks, or any other format — tool call only.`;
}

export function composeStructuredInvocation(
  system: string,
  user: string,
  toolName: string,
): { readonly system: string; readonly user: string } {
  const directive = buildToolUseDirective(toolName);
  return {
    system: `${system}\n\n${directive}`,
    user: `${user}\n\n---\nRESPONSE FORMAT (MANDATORY): ${directive}`,
  };
}

export function buildEmitToolDescription(name: string): string {
  return `Return the structured ${name} result. Call this tool exactly once.`;
}
