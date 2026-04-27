import { memo } from 'react';
import { ExternalAgentWidget } from './ExternalAgentWidget';
import { lookupLiveController } from '@/agent/externalAgent/liveControllerRegistry';

export interface ExternalAgentLiveBlockProps {
  readonly props: unknown;
}

function ExternalAgentLiveBlockImpl(props: ExternalAgentLiveBlockProps): JSX.Element | null {
  const raw = props.props;
  if (raw === null || typeof raw !== 'object') return null;
  const runId = (raw as { runId?: unknown }).runId;
  if (typeof runId !== 'string') return null;
  const controller = lookupLiveController(runId);
  if (controller === null) {
    return (
      <section
        className="leo-root leo-external-agent leo-ea-live-missing"
        data-slot="external-agent"
        data-phase="missing"
        aria-label="External agent run not active"
      >
        <p className="leo-ea-summary-text">
          External Agent run is no longer active. The result will appear once it completes.
        </p>
      </section>
    );
  }
  return <ExternalAgentWidget controller={controller} />;
}

export const ExternalAgentLiveBlock = memo(ExternalAgentLiveBlockImpl);
