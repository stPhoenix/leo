import type { CompactionResult } from '@/agent/autocompact';
import type { CompactWidgetController } from './widgetController';
import type { CompactErrorCode, CompactTrigger } from './widgetState';

export interface CompactPhaseSink {
  start(trigger: CompactTrigger, preTokens: number): void;
  summarizing(): void;
  buildingAttachments(): void;
  done(result: CompactionResult): void;
  error(code: CompactErrorCode, message: string): void;
  cancelled(): void;
}

export function makePhaseSinkFromController(controller: CompactWidgetController): CompactPhaseSink {
  return {
    start(_trigger, preTokens) {
      controller.setPhase('preparing', { preTokens });
    },
    summarizing() {
      controller.setPhase('summarizing');
    },
    buildingAttachments() {
      controller.setPhase('building_attachments');
    },
    done(result) {
      controller.setPhase('done', {
        preTokens: result.preCompactTokenCount,
        postTokens: result.postCompactTokenCount,
        inputTokens: result.compactionInputTokens,
        outputTokens: result.compactionOutputTokens,
        attachmentCount: result.attachments.length,
      });
    },
    error(code, message) {
      controller.recordError(code, message);
    },
    cancelled() {
      controller.setPhase('cancelled');
    },
  };
}
