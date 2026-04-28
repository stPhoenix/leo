import { describe, expect, it } from 'vitest';
import {
  countToolDescriptorTokens,
  estimateToolDescriptorTokens,
  TOOL_TOKEN_COUNT_OVERHEAD,
} from '@/agent/toolTokenCount';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';

describe('toolTokenCount', () => {
  it('subtracts the 500-token preamble per SRS §5.3', () => {
    const longSchema = JSON.stringify({ type: 'object', properties: { x: { type: 'string' } } });
    const tool = { name: 'edit_note', description: 'edits a note', schemaJson: longSchema };
    const raw = roughTokenCountEstimation(['edit_note', 'edits a note', longSchema].join('\n'));
    expect(estimateToolDescriptorTokens(tool)).toBe(Math.max(0, raw - TOOL_TOKEN_COUNT_OVERHEAD));
  });

  it('clamps to 0 when description+schema is below the overhead', () => {
    const tool = { name: 't', description: 'd', schemaJson: '{}' };
    expect(estimateToolDescriptorTokens(tool)).toBe(0);
  });

  it('handles missing optional fields', () => {
    expect(estimateToolDescriptorTokens({ name: 'a' })).toBe(0);
  });

  it('aggregates total + perTool', () => {
    const tools = [
      { name: 't1', description: 'd', schemaJson: 'x'.repeat(4000) },
      { name: 't2', description: 'd', schemaJson: 'x'.repeat(4000) },
    ];
    const r = countToolDescriptorTokens(tools);
    expect(r.perTool).toHaveLength(2);
    expect(r.total).toBe(r.perTool[0]!.tokens + r.perTool[1]!.tokens);
    expect(r.perTool[0]!.tokens).toBeGreaterThan(0);
  });
});
