import { TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { Logger } from '@/platform/Logger';

export interface CanvasBbox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type CanvasNavigatorWarning = 'reveal_unsupported_in_this_obsidian_version';

export interface OpenCanvasResult {
  readonly ok: true;
  readonly leaf: WorkspaceLeaf;
}

export interface OpenCanvasError {
  readonly ok: false;
  readonly error: string;
}

export interface CanvasNavigator {
  openCanvas(path: string): Promise<OpenCanvasResult | OpenCanvasError>;
  panZoomToBbox(leaf: WorkspaceLeaf, bbox: CanvasBbox, padding: number): boolean;
}

export interface CanvasNavigatorOptions {
  readonly app: App;
  readonly logger?: Logger;
}

interface InternalCanvasView {
  canvas?: InternalCanvasInstance;
}

interface InternalCanvasInstance {
  zoomToBbox?: (bbox: { minX: number; minY: number; maxX: number; maxY: number }) => unknown;
  tx?: number;
  ty?: number;
  tZoom?: number;
  requestFrame?: () => unknown;
}

const detectionCache = new WeakMap<WorkspaceLeaf, boolean>();

export const CANVAS_VIEW_TYPE = 'canvas';

export function createObsidianCanvasNavigator(opts: CanvasNavigatorOptions): CanvasNavigator {
  const { app, logger } = opts;

  const findLeafForPath = (path: string): WorkspaceLeaf | null => {
    const leaves = app.workspace.getLeavesOfType(CANVAS_VIEW_TYPE);
    for (const leaf of leaves) {
      const file = (leaf.view as unknown as { file?: TFile }).file;
      if (file?.path === path) return leaf;
    }
    return null;
  };

  return {
    async openCanvas(path) {
      try {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) {
          return { ok: false, error: `canvas not found: ${path}` };
        }
        const existing = findLeafForPath(path);
        if (existing !== null) {
          app.workspace.setActiveLeaf(existing, { focus: true });
          app.workspace.revealLeaf(existing);
          logger?.debug('canvas.reveal.openCanvas.revealed', { path });
          return { ok: true, leaf: existing };
        }
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file);
        logger?.debug('canvas.reveal.openCanvas.opened', { path });
        return { ok: true, leaf };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn('canvas.reveal.openCanvas.error', { path, error: message });
        return { ok: false, error: message };
      }
    },

    panZoomToBbox(leaf, bbox, padding) {
      try {
        const view = leaf.view as unknown as InternalCanvasView;
        const canvas = view?.canvas;
        if (!canvas) {
          if (!detectionCache.has(leaf)) {
            detectionCache.set(leaf, false);
            logger?.debug('canvas.reveal.featureDetect', { ok: false, reason: 'no-canvas' });
          }
          return false;
        }
        if (typeof canvas.zoomToBbox !== 'function') {
          if (!detectionCache.has(leaf)) {
            detectionCache.set(leaf, false);
            logger?.debug('canvas.reveal.featureDetect', { ok: false, reason: 'no-zoomToBbox' });
          }
          return false;
        }
        if (!detectionCache.get(leaf)) {
          detectionCache.set(leaf, true);
          logger?.debug('canvas.reveal.featureDetect', { ok: true });
        }
        const minX = bbox.x - padding;
        const minY = bbox.y - padding;
        const maxX = bbox.x + bbox.w + padding;
        const maxY = bbox.y + bbox.h + padding;
        canvas.zoomToBbox({ minX, minY, maxX, maxY });
        if (typeof canvas.requestFrame === 'function') canvas.requestFrame();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger?.warn('canvas.reveal.panZoom.error', { error: message });
        return false;
      }
    },
  };
}
