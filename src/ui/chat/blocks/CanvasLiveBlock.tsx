import { memo } from 'react';
import { CanvasWidget } from './CanvasWidget';
import {
  CANVAS_LIVE_KIND,
  lookupCanvasLiveController,
} from '@/agent/canvas/liveControllerRegistry';
import { CanvasWidgetController } from '@/agent/canvas/widget/widgetController';
import type { CanvasOp } from '@/agent/canvas/mutex';
import { registerWidget, type WidgetComponentProps } from '../widgets/registry';

interface CanvasLiveProps {
  readonly runId: string;
  readonly threadId: string;
  readonly op: CanvasOp;
  readonly targetPath: string;
  readonly originalAsk: string;
}

function CanvasLiveBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const raw = props as Partial<CanvasLiveProps> | null;
  if (raw === null || typeof raw !== 'object') return null;
  const runId = raw.runId;
  const threadId = raw.threadId;
  const op = raw.op;
  const targetPath = raw.targetPath ?? '';
  const originalAsk = raw.originalAsk ?? '';
  if (typeof runId !== 'string' || typeof threadId !== 'string') return null;
  if (op !== 'create' && op !== 'content_edit' && op !== 'layout_edit') return null;

  const live = lookupCanvasLiveController(runId);
  if (live !== null && live instanceof CanvasWidgetController) {
    return <CanvasWidget controller={live} />;
  }
  const synthetic = CanvasWidgetController.reloadRehydrate({
    runId,
    threadId,
    op,
    targetPath,
    originalAsk,
  });
  return <CanvasWidget controller={synthetic} />;
}

export const CanvasLiveBlock = memo(CanvasLiveBlockImpl);

registerWidget(CANVAS_LIVE_KIND, CanvasLiveBlock);
