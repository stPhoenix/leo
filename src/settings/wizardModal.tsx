import { Modal, type App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import type { ProviderModel } from '@/providers/types';
import { WizardApp } from './WizardApp';

export interface WizardModalDeps {
  readonly initialEndpoint: string;
  readonly initialChatModel: string;
  readonly initialEmbeddingModel: string;
  readonly probe: (endpoint: string) => Promise<ProviderModel[]>;
  readonly persist: (result: WizardResult) => Promise<void>;
}

export interface WizardResult {
  readonly endpoint: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
}

export class WizardModal extends Modal {
  private root: Root | null = null;

  constructor(
    app: App,
    private readonly deps: WizardModalDeps,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText('Configure LM Studio');
    this.modalEl.addClass('leo-wizard-modal');
    const host = this.contentEl.createDiv({ cls: 'leo-wizard-root' });
    this.root = createRoot(host);
    this.root.render(
      createElement(WizardApp, {
        initialEndpoint: this.deps.initialEndpoint,
        initialChatModel: this.deps.initialChatModel,
        initialEmbeddingModel: this.deps.initialEmbeddingModel,
        probe: this.deps.probe,
        persist: this.deps.persist,
        onClose: () => this.close(),
      }),
    );
  }

  override onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}

export function makeWizardProbe(): (endpoint: string) => Promise<ProviderModel[]> {
  return async (endpoint) => {
    const provider = new LMStudioProvider({ endpoint: () => endpoint });
    return provider.listModels();
  };
}
