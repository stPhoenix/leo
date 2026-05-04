import type { ToolSpec } from '@/tools/types';

export function renderTextSchemas(
  matches: readonly string[],
  allSpecs: readonly ToolSpec[],
): string {
  const byId = new Map<string, ToolSpec>();
  for (const s of allSpecs) byId.set(s.id, s);
  const lines: string[] = ['<functions>'];
  for (const name of matches) {
    const spec = byId.get(name);
    if (spec === undefined) continue;
    const json = JSON.stringify({
      description: spec.description,
      name: spec.id,
      parameters: spec.parameters,
    });
    lines.push(`<function>${json}</function>`);
  }
  lines.push('</functions>');
  return lines.join('\n');
}
