import { memo } from 'react';
import { WikiWidget } from './WikiWidget';
import { WIKI_LIVE_KIND, lookupWikiLiveController } from '@/agent/wiki/liveControllerRegistry';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import { registerWidget, type WidgetComponentProps } from '../widgets/registry';

interface WikiLiveProps {
  readonly runId: string;
  readonly threadId: string;
  readonly op: 'ingest' | 'lint';
}

function WikiLiveBlockImpl({ props }: WidgetComponentProps): JSX.Element | null {
  const raw = props as Partial<WikiLiveProps> | null;
  if (raw === null || typeof raw !== 'object') return null;
  const runId = raw.runId;
  const threadId = raw.threadId;
  const op = raw.op;
  if (typeof runId !== 'string' || typeof threadId !== 'string') return null;
  if (op !== 'ingest' && op !== 'lint') return null;

  const live = lookupWikiLiveController(runId);
  if (live !== null && live instanceof WikiWidgetController) {
    return <WikiWidget controller={live} />;
  }
  // Reload-rehydrate path — render a synthetic controller in error.code='reload'.
  const synthetic = WikiWidgetController.reloadRehydrate({ runId, threadId, op });
  return <WikiWidget controller={synthetic} />;
}

export const WikiLiveBlock = memo(WikiLiveBlockImpl);

registerWidget(WIKI_LIVE_KIND, WikiLiveBlock);
