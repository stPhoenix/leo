import { memo } from 'react';
import { CompactWidget } from './CompactWidget';
import {
  COMPACT_LIVE_KIND,
  lookupCompactLiveController,
} from '@/agent/compact/liveControllerRegistry';
import { CompactWidgetController } from '@/agent/compact/widgetController';
import { registerWidget, type WidgetComponentProps } from '../widgets/registry';

interface CompactLiveProps {
  readonly runId: string;
  readonly threadId: string;
  readonly trigger: 'manual' | 'auto';
}

function CompactLiveBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const raw = props as Partial<CompactLiveProps> | null;
  if (raw === null || typeof raw !== 'object') return null;
  const runId = raw.runId;
  const threadId = raw.threadId;
  const trigger = raw.trigger;
  if (typeof runId !== 'string' || typeof threadId !== 'string') return null;
  if (trigger !== 'manual' && trigger !== 'auto') return null;

  const live = lookupCompactLiveController(runId);
  if (live !== null && live instanceof CompactWidgetController) {
    return <CompactWidget controller={live} />;
  }
  const synthetic = CompactWidgetController.reloadRehydrate({ runId, threadId, trigger });
  return <CompactWidget controller={synthetic} />;
}

export const CompactLiveBlock = memo(CompactLiveBlockImpl);

registerWidget(COMPACT_LIVE_KIND, CompactLiveBlock);
