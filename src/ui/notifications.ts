export interface NoticeChannel {
  show(message: string): void;
}

export interface StatusBarChannel {
  setText(text: string): void;
  clear(): void;
  remove(): void;
}

export interface StatusBarFactory {
  create(): StatusBarChannel;
}

export interface InlineDialogHost {
  mount(node: HTMLElement, content: BlockingErrorContent): () => void;
  isNativeModal(): false;
}

export interface BlockingErrorContent {
  readonly title: string;
  readonly message: string;
  readonly primaryLabel?: string;
  readonly onPrimary?: () => void;
}

export interface ToolConfirmationRequest {
  readonly toolId: string;
  readonly args: unknown;
  readonly resolve: (decision: 'allow-once' | 'allow-thread' | 'deny') => void;
}

export interface InlineConfirmationHost {
  present(req: ToolConfirmationRequest): () => void;
  isNativeModal(): false;
}

export interface NotificationsDeps {
  readonly notice: NoticeChannel;
  readonly statusBar: StatusBarFactory;
  readonly inlineDialog: InlineDialogHost;
  readonly inlineConfirmation: InlineConfirmationHost;
}

export class Notifications {
  private readonly statusItems = new Map<string, StatusBarChannel>();
  private activeBlockingDismiss: (() => void) | null = null;
  private activeConfirmationDismiss: (() => void) | null = null;

  constructor(private readonly deps: NotificationsDeps) {}

  notice(message: string): void {
    this.deps.notice.show(message);
  }

  status(key: string, message: string): void {
    let item = this.statusItems.get(key);
    if (item === undefined) {
      item = this.deps.statusBar.create();
      this.statusItems.set(key, item);
    }
    item.setText(message);
  }

  clearStatus(key: string): void {
    const item = this.statusItems.get(key);
    if (item === undefined) return;
    item.clear();
  }

  removeStatus(key: string): void {
    const item = this.statusItems.get(key);
    if (item === undefined) return;
    item.remove();
    this.statusItems.delete(key);
  }

  blockingError(host: HTMLElement, content: BlockingErrorContent): () => void {
    if (this.activeBlockingDismiss !== null) this.activeBlockingDismiss();
    const dismiss = this.deps.inlineDialog.mount(host, content);
    const wrapped = (): void => {
      dismiss();
      if (this.activeBlockingDismiss === wrapped) this.activeBlockingDismiss = null;
    };
    this.activeBlockingDismiss = wrapped;
    return wrapped;
  }

  requestToolConfirmation(req: ToolConfirmationRequest): () => void {
    if (this.activeConfirmationDismiss !== null) this.activeConfirmationDismiss();
    const dismiss = this.deps.inlineConfirmation.present(req);
    const wrapped = (): void => {
      dismiss();
      if (this.activeConfirmationDismiss === wrapped) this.activeConfirmationDismiss = null;
    };
    this.activeConfirmationDismiss = wrapped;
    return wrapped;
  }

  dispose(): void {
    if (this.activeBlockingDismiss !== null) {
      this.activeBlockingDismiss();
      this.activeBlockingDismiss = null;
    }
    if (this.activeConfirmationDismiss !== null) {
      this.activeConfirmationDismiss();
      this.activeConfirmationDismiss = null;
    }
    for (const item of this.statusItems.values()) item.remove();
    this.statusItems.clear();
  }
}
