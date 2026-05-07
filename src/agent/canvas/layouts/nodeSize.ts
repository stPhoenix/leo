import { CANVAS_NODE_SIZE_OVERRIDES, CANVAS_NODE_SIZING } from '../budgets';

export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

export type NodeKind = 'text' | 'file';

export function nodeSizeFor(entity: {
  type: string;
  name: string;
  fields?: unknown;
  filePath?: string;
}): NodeSize {
  const kind: NodeKind =
    entity.filePath !== undefined && entity.filePath.length > 0 ? 'file' : 'text';
  const text = formatLabel(entity);
  const lineCount = Math.max(1, text.split('\n').length);
  const labelWidth = Math.round(text.length * 6);
  const labelHeight = Math.round(lineCount * 24 + 48);

  const wMin = kind === 'file' ? CANVAS_NODE_SIZING.fileWidthMin : CANVAS_NODE_SIZING.textWidthMin;
  const wMax = kind === 'file' ? CANVAS_NODE_SIZING.fileWidthMax : CANVAS_NODE_SIZING.textWidthMax;
  const hMin =
    kind === 'file' ? CANVAS_NODE_SIZING.fileHeightMin : CANVAS_NODE_SIZING.textHeightMin;
  const hMax =
    kind === 'file' ? CANVAS_NODE_SIZING.fileHeightMax : CANVAS_NODE_SIZING.textHeightMax;

  const width = clamp(labelWidth, wMin, wMax);
  const height = clamp(labelHeight, hMin, hMax);
  const override = CANVAS_NODE_SIZE_OVERRIDES[entity.type];
  return {
    width: override?.width ?? width,
    height: override?.height ?? height,
  };
}

function formatLabel(entity: { type: string; name: string }): string {
  return `${entity.name}\n[${entity.type}]`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
