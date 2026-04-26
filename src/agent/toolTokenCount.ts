import { roughTokenCountEstimation } from './tokenEstimator';

export const TOOL_TOKEN_COUNT_OVERHEAD = 500;

export interface ToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly schemaJson?: string;
}

export interface ToolDescriptorTokens {
  readonly name: string;
  readonly tokens: number;
}

export function estimateToolDescriptorTokens(tool: ToolDescriptor): number {
  const parts = [tool.name, tool.description ?? '', tool.schemaJson ?? ''];
  const raw = roughTokenCountEstimation(parts.join('\n'));
  return Math.max(0, raw - TOOL_TOKEN_COUNT_OVERHEAD);
}

export function countToolDescriptorTokens(tools: readonly ToolDescriptor[]): {
  readonly total: number;
  readonly perTool: readonly ToolDescriptorTokens[];
} {
  const perTool: ToolDescriptorTokens[] = [];
  let total = 0;
  for (const t of tools) {
    const tokens = estimateToolDescriptorTokens(t);
    perTool.push({ name: t.name, tokens });
    total += tokens;
  }
  return { total, perTool };
}
