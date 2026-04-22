import {
  buildUserContent,
  detectVaultDrop,
  estimateAttachmentTokens,
  isVisionGateBlocked,
  toBase64,
  type Attachment,
  type ContentBlock,
  type VaultDropDetectionInput,
  type VaultDropResult,
  type VisionGateInput,
} from './attachments';
import { AttachmentsStore, type AttachmentsStoreOptions } from './attachmentsStore';

export interface WireAttachmentsOptions extends AttachmentsStoreOptions {}

export interface AttachmentsWiring {
  readonly store: AttachmentsStore;
  buildUserContent(text: string, attachments: readonly Attachment[]): ContentBlock[];
  detectVaultDrop(input: VaultDropDetectionInput): VaultDropResult | null;
  estimateTokens(blocks: readonly ContentBlock[]): number;
  isVisionGateBlocked(input: VisionGateInput): boolean;
  dispose(): void;
}

export function wireAttachments(opts: WireAttachmentsOptions = {}): AttachmentsWiring {
  const store = new AttachmentsStore(opts);
  let disposed = false;
  return {
    store,
    buildUserContent: (text, attachments) => buildUserContent(text, attachments, toBase64),
    detectVaultDrop,
    estimateTokens: estimateAttachmentTokens,
    isVisionGateBlocked,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      store.dispose();
    },
  };
}
