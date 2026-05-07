import type { CanvasNode } from '../canvasJson';
import type { Entity } from '../schemas';

export function buildCanvasNode(
  entity: Entity,
  x: number,
  y: number,
  size: { readonly width: number; readonly height: number },
  color?: string,
): CanvasNode {
  if (entity.filePath !== undefined && entity.filePath.length > 0) {
    return {
      type: 'file',
      id: entity.id,
      x,
      y,
      width: size.width,
      height: size.height,
      file: entity.filePath,
      ...(color !== undefined ? { color } : {}),
    };
  }
  return {
    type: 'text',
    id: entity.id,
    x,
    y,
    width: size.width,
    height: size.height,
    text: `${entity.name}\n[${entity.type}]`,
    ...(color !== undefined ? { color } : {}),
  };
}
