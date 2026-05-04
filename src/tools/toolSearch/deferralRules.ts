import type { ToolSpec } from '@/tools/types';
import type { DeferralPartition, DeferralRulesContext } from './types';

export function isDeferred(spec: ToolSpec, ctx: DeferralRulesContext): boolean {
  if (spec.alwaysLoad === true) return false;
  if (spec.id === ctx.toolSearchToolId) return false;
  if (ctx.alwaysLoadIds?.has(spec.id) === true) return false;
  if (spec.isMcp === true) return true;
  if (spec.shouldDefer === true) return true;
  return false;
}

export function partitionTools(
  specs: readonly ToolSpec[],
  discovered: ReadonlySet<string>,
  ctx: DeferralRulesContext,
): DeferralPartition {
  const included: ToolSpec[] = [];
  const deferLoading = new Set<string>();
  for (const spec of specs) {
    if (!isDeferred(spec, ctx)) {
      included.push(spec);
      continue;
    }
    if (discovered.has(spec.id)) {
      included.push(spec);
      continue;
    }
    deferLoading.add(spec.id);
  }
  return { included, deferLoading };
}
