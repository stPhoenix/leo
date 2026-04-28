import type { Logger } from '@/platform/Logger';
import type { VaultIndexer } from './vaultIndexer';
import type { VectorStore } from '@/storage/vectorStore';

export type ReindexConfirmChoice = 'reindex' | 'cancel';
export type ModelSwitchChoice = 'now' | 'later' | 'revert';

export interface ReindexServiceOptions {
  readonly indexer: VaultIndexer;
  readonly vectorStore?: VectorStore;
  readonly confirmReindex: () => Promise<ReindexConfirmChoice>;
  readonly confirmModelSwitch: (prev: { model: string }) => Promise<ModelSwitchChoice>;
  readonly revertModelSetting?: (prev: { model: string }) => Promise<void>;
  readonly logger?: Logger;
}

export class ReindexService {
  private readonly indexer: VaultIndexer;
  private readonly vectorStore: VectorStore | null;
  private readonly confirmReindex: () => Promise<ReindexConfirmChoice>;
  private readonly confirmModelSwitch: (prev: { model: string }) => Promise<ModelSwitchChoice>;
  private readonly revertModelSetting: ((prev: { model: string }) => Promise<void>) | null;
  private readonly logger: Logger | undefined;
  private inFlight = false;

  constructor(opts: ReindexServiceOptions) {
    this.indexer = opts.indexer;
    this.vectorStore = opts.vectorStore ?? null;
    this.confirmReindex = opts.confirmReindex;
    this.confirmModelSwitch = opts.confirmModelSwitch;
    this.revertModelSetting = opts.revertModelSetting ?? null;
    this.logger = opts.logger;
  }

  /**
   * Command-palette entry point. Returns the path count that was re-enqueued,
   * or `null` when the user cancelled / the command was a no-op.
   */
  async reindexVault(): Promise<number | null> {
    if (this.inFlight) {
      this.logger?.debug('indexer.ui.reindex-command', { reason: 'debounced-in-flight' });
      return null;
    }
    const choice = await this.confirmReindex();
    if (choice === 'cancel') {
      this.logger?.info('indexer.ui.reindex-command', { confirmed: false });
      return null;
    }
    this.inFlight = true;
    this.logger?.info('indexer.ui.reindex-command', { confirmed: true });
    try {
      if (this.vectorStore !== null) {
        await this.vectorStore.rebuild();
      }
      const count = await this.indexer.reindexAll();
      return count;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Called when the user changes the embedding model in settings — routes the
   * three-way prompt `now`/`later`/`revert` matching F27's startup contract.
   */
  async handleModelSwitch(prev: { model: string }): Promise<ModelSwitchChoice> {
    const choice = await this.confirmModelSwitch(prev);
    this.logger?.info('indexer.ui.model-switch-prompt', { choice });
    if (choice === 'now') {
      await this.reindexVault();
      return 'now';
    }
    if (choice === 'revert' && this.revertModelSetting !== null) {
      await this.revertModelSetting(prev);
    }
    return choice;
  }

  isInFlight(): boolean {
    return this.inFlight;
  }
}
