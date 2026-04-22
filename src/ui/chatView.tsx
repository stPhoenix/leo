import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  setIcon,
  type WorkspaceLeaf,
} from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import type { Logger } from '@/platform/Logger';
import { ChatMessageStore } from '@/chat/messageStore';
import { StreamingTurnController, type StreamingPhase } from '@/chat/streamingController';
import type { StreamEvent } from '@/providers/types';
import type { FocusedContextChannel } from '@/editor/focusedContextChannel';
import type { FocusedContext } from '@/editor/types';
import type { ConfirmationController } from '@/agent/confirmationController';
import type { AcceptRejectController } from '@/agent/acceptRejectController';
import type { PlanApprovalController } from '@/agent/planApprovalController';
import type { ContextData } from '@/agent/contextAnalyzer';
import { resolveContextWindow } from '@/agent/compactConstants';
import { makeInlineConfirmationSource } from './chat/InlineConfirmation';
import { makeAcceptRejectSource } from './chat/InlineDialog';
import { makePlanApprovalSource } from './chat/PlanApprovalDialog';
import type { SkillPickerSource } from './chat/SkillPicker';
import { ChatRoot } from './chat/ChatRoot';
import type { CodeBlockClipboard } from './chat/codeBlockEnhancer';
import { TurnDispatcher } from './chat/turnDispatcher';
import { createSlashRegistry, type SlashRegistry } from './chat/slashCommands';
import { createContextCommand, type ContextCommandHandle } from './contextCommand';
import './chat/widgets/ContextWidget';
import type { MessageActions } from './chat/MessageActionBar';
import type { IndexStatusSource } from './chat/IndexEmptyStateCta';
import type { DrainListener } from '@/indexer/vaultIndexer';
import { VIEW_TYPE_LEO_CHAT } from './viewType';

export interface ChatStreamStarter {
  (prompt: string, signal: AbortSignal): AsyncIterable<StreamEvent>;
}

export interface ChatPlanModeAdapter {
  enter(): void;
  exit?(): void;
}

export interface ChatViewDeps {
  readonly logger?: Logger;
  readonly messageStore?: ChatMessageStore;
  readonly streamStarter?: ChatStreamStarter;
  readonly focusedContext?: FocusedContextChannel;
  readonly confirmationController?: ConfirmationController;
  readonly acceptRejectController?: AcceptRejectController;
  readonly skillPickerSource?: SkillPickerSource;
  readonly planMode?: ChatPlanModeAdapter;
  readonly analyzeContext?: (signal: AbortSignal) => Promise<ContextData>;
  readonly indexStatusSource?: IndexStatusSource;
  readonly indexDrainSubscribe?: (listener: DrainListener) => () => void;
  readonly onIndexVault?: () => void;
  readonly planApprovalController?: PlanApprovalController;
  readonly resolveCostUSD?: (usage: { input: number; output: number }) => number | null;
}

export class ChatView extends ItemView {
  readonly messageStore: ChatMessageStore;
  private root: Root | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private widthListeners = new Set<(w: number) => void>();
  private renderComponents = new Set<Component>();
  private streamingController: StreamingTurnController | null = null;
  private turnDispatcher: TurnDispatcher | null = null;
  private slashRegistry: SlashRegistry | null = null;
  private contextCommand: ContextCommandHandle | null = null;
  private liveRegionEl: HTMLElement | null = null;
  private phaseListeners = new Set<(p: StreamingPhase) => void>();
  private lastPhase: StreamingPhase = 'idle';

  constructor(
    leaf: WorkspaceLeaf,
    private readonly deps: ChatViewDeps = {},
  ) {
    super(leaf);
    this.messageStore = deps.messageStore ?? new ChatMessageStore();
  }

  override getViewType(): string {
    return VIEW_TYPE_LEO_CHAT;
  }

  override getDisplayText(): string {
    return 'Leo';
  }

  override getIcon(): string {
    return 'bot';
  }

  override async onOpen(): Promise<void> {
    const host = this.containerEl.children.item(1) as HTMLElement | null;
    if (host === null) return;
    host.empty();
    host.addClass('leo-chat-view-host');

    const liveRegion = host.createEl('div', { cls: 'leo-stream-live-region leo-sr-only' });
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'assertive');
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.setAttribute('data-slot', 'stream-live-region');
    this.liveRegionEl = liveRegion;

    this.streamingController = new StreamingTurnController({
      messageStore: this.messageStore,
      announce: (msg) => {
        if (this.liveRegionEl === null) return;
        this.liveRegionEl.textContent = msg;
      },
      onPhaseChange: (p) => {
        this.lastPhase = p;
        for (const l of this.phaseListeners) l(p);
      },
    });
    this.turnDispatcher = new TurnDispatcher({
      messageStore: this.messageStore,
      controller: this.streamingController,
      ...(this.deps.streamStarter !== undefined ? { starter: this.deps.streamStarter } : {}),
    });
    this.slashRegistry = this.buildSlashRegistry();

    const observeWidth = (cb: (w: number) => void): (() => void) => {
      this.widthListeners.add(cb);
      cb(host.clientWidth);
      return () => {
        this.widthListeners.delete(cb);
      };
    };

    const renderMarkdown = (text: string, container: HTMLElement): (() => void) => {
      const cmp = new Component();
      this.renderComponents.add(cmp);
      cmp.load();
      void MarkdownRenderer.render(this.app, text, container, '', cmp);
      return () => {
        this.renderComponents.delete(cmp);
        cmp.unload();
      };
    };

    const clipboard: CodeBlockClipboard = {
      copy: async (text) => {
        await navigator.clipboard.writeText(text);
      },
      notify: (message) => {
        new Notice(message);
      },
    };

    const focusedContextSource = this.buildContextIndicatorSource();
    const messageActions = this.buildMessageActions();
    const confirmationSource =
      this.deps.confirmationController !== undefined
        ? makeInlineConfirmationSource(this.deps.confirmationController)
        : undefined;
    const acceptRejectSource =
      this.deps.acceptRejectController !== undefined
        ? makeAcceptRejectSource(this.deps.acceptRejectController)
        : undefined;
    const planApprovalSource =
      this.deps.planApprovalController !== undefined
        ? makePlanApprovalSource(this.deps.planApprovalController)
        : undefined;
    const renderPlanMarkdown = (container: HTMLElement, plan: string): (() => void) => {
      const cmp = new Component();
      this.renderComponents.add(cmp);
      cmp.load();
      void MarkdownRenderer.render(this.app, plan, container, '', cmp);
      return () => {
        this.renderComponents.delete(cmp);
        cmp.unload();
      };
    };

    this.root = createRoot(host);
    this.root.render(
      createElement(ChatRoot, {
        initialWidth: host.clientWidth,
        observeWidth,
        onOverflowMenu: (anchor) => this.openOverflowMenu(anchor),
        messageStore: this.messageStore,
        renderMarkdown,
        clipboard,
        setIcon: (el, name) => setIcon(el, name),
        ...(focusedContextSource !== null
          ? {
              contextIndicatorSource: focusedContextSource,
              onRevealContextFile: (path: string) => this.revealFile(path),
            }
          : {}),
        messageActions,
        ...(confirmationSource !== undefined ? { confirmationSource } : {}),
        ...(acceptRejectSource !== undefined ? { acceptRejectSource } : {}),
        ...(this.deps.skillPickerSource !== undefined
          ? { skillPickerSource: this.deps.skillPickerSource }
          : {}),
        ...(this.deps.indexStatusSource !== undefined
          ? { indexStatusSource: this.deps.indexStatusSource }
          : {}),
        ...(this.deps.indexDrainSubscribe !== undefined
          ? { indexDrainSubscribe: this.deps.indexDrainSubscribe }
          : {}),
        ...(this.deps.onIndexVault !== undefined ? { onIndexVault: this.deps.onIndexVault } : {}),
        ...(planApprovalSource !== undefined ? { planApprovalSource } : {}),
        renderPlanMarkdown,
        ...(this.deps.resolveCostUSD !== undefined
          ? { resolveCostUSD: this.deps.resolveCostUSD }
          : {}),
        phaseSource: {
          getPhase: () => this.lastPhase,
          subscribe: (cb) => {
            const wrapped = (): void => cb();
            this.phaseListeners.add(wrapped);
            return () => {
              this.phaseListeners.delete(wrapped);
            };
          },
        },
        queueSource: {
          getLength: () => this.turnDispatcher?.queueLength() ?? 0,
          subscribe: (cb) => this.turnDispatcher?.subscribe(cb) ?? ((): void => undefined),
        },
        composer: {
          onSubmit: (text) => {
            this.deps.logger?.info('composer.submit', { length: text.length });
            if (this.slashRegistry?.tryHandle(text) === true) return;
            this.beginTurn(text);
          },
          onStopIntent: () => {
            this.deps.logger?.info('composer.stop_intent', {});
            this.streamingController?.stop();
          },
          onOpenCommandPalette: () => this.openCommandPalette(),
          ...(this.slashRegistry !== null ? { slashCommands: this.slashRegistry.list() } : {}),
        },
      }),
    );

    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const w = entry.contentRect.width;
      for (const l of this.widthListeners) l(w);
    });
    this.resizeObserver.observe(host);

    this.deps.logger?.info('view.open', { type: VIEW_TYPE_LEO_CHAT });
  }

  override async onClose(): Promise<void> {
    this.deps.logger?.info('view.close', { type: VIEW_TYPE_LEO_CHAT });
    this.contextCommand?.cancel();
    this.contextCommand = null;
    this.slashRegistry = null;
    this.turnDispatcher?.dispose();
    this.turnDispatcher = null;
    this.streamingController?.dispose();
    this.streamingController = null;
    this.phaseListeners.clear();
    this.lastPhase = 'idle';
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.widthListeners.clear();
    this.root?.unmount();
    this.root = null;
    for (const c of this.renderComponents) c.unload();
    this.renderComponents.clear();
    this.liveRegionEl = null;
    const host = this.containerEl.children.item(1) as HTMLElement | null;
    host?.empty();
  }

  private beginTurn(text: string): void {
    this.turnDispatcher?.submit(text);
  }

  private buildSlashRegistry(): SlashRegistry {
    const registry = createSlashRegistry({
      ...(this.deps.logger !== undefined ? { logger: this.deps.logger } : {}),
      onError: (err) => new Notice(`Command failed: ${err.message}`),
    });
    registry.register({
      name: 'clear',
      description: 'Clear chat and reset agent state',
      run: () => this.handleSlashClear(),
    });
    const planMode = this.deps.planMode;
    if (planMode !== undefined) {
      registry.register({
        name: 'plan',
        description: 'Enter plan mode (read-only tools until ExitPlanMode)',
        run: () => planMode.enter(),
      });
    }
    const analyze = this.deps.analyzeContext;
    if (analyze !== undefined) {
      this.contextCommand = createContextCommand<ContextData>({
        analyze,
        render: (data) => this.renderContextAsWidget(data),
        onError: (err) => new Notice(`Context: ${err.message}`),
        ...(this.deps.logger !== undefined ? { logger: this.deps.logger } : {}),
      });
      const handle = this.contextCommand;
      registry.register({
        name: 'context',
        description: 'Show context usage breakdown',
        run: () => handle.invoke(),
      });
    }
    return registry;
  }

  private handleSlashClear(): void {
    this.streamingController?.stop();
    this.streamingController?.dispose();
    this.turnDispatcher?.clear();
    this.messageStore.clear();
    this.deps.logger?.info('slash.clear', {});
  }

  private renderContextAsWidget(data: ContextData): void {
    const contextWindow = resolveContextWindow({ model: data.model });
    const now = new Date().toISOString();
    this.messageStore.append({
      id: `ctx-${Date.now()}`,
      role: 'widget',
      content: '',
      createdAt: now,
      widget: { kind: 'context', props: { data, contextWindow } },
    });
  }

  private openOverflowMenu(_anchor: HTMLElement): void {
    /* later features extend through addAction or via dependency injection */
  }

  private openCommandPalette(): void {
    const commands = (
      this.app as unknown as {
        commands?: { executeCommandById?(id: string): void };
      }
    ).commands;
    commands?.executeCommandById?.('command-palette:open');
  }

  private buildContextIndicatorSource(): {
    getContext: () => FocusedContext;
    subscribe: (cb: () => void) => () => void;
  } | null {
    const channel = this.deps.focusedContext;
    if (channel === undefined) return null;
    return {
      getContext: () => channel.current(),
      subscribe: (cb) => channel.subscribe(() => cb()),
    };
  }

  private revealFile(path: string): void {
    void this.app.workspace.openLinkText(path, '', false);
  }

  private buildMessageActions(): MessageActions {
    return {
      copy: async (record) => {
        try {
          await navigator.clipboard.writeText(record.content);
          new Notice('Copied message');
        } catch {
          new Notice('Copy failed');
        }
      },
      delete: (id) => {
        const records = this.messageStore.getSnapshot();
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return;
        const target = records[idx];
        if (target?.role === 'user') {
          let end = idx + 1;
          while (end < records.length && records[end]?.role !== 'user') end += 1;
          this.messageStore.set([...records.slice(0, idx), ...records.slice(end)]);
        } else {
          this.messageStore.set([...records.slice(0, idx), ...records.slice(idx + 1)]);
        }
      },
      regenerate: (id) => {
        const records = this.messageStore.getSnapshot();
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return;
        let userIdx = idx - 1;
        while (userIdx >= 0 && records[userIdx]?.role !== 'user') userIdx -= 1;
        if (userIdx < 0) return;
        const userText = records[userIdx]!.content;
        let end = idx + 1;
        while (end < records.length && records[end]?.role === 'banner') end += 1;
        this.messageStore.set([...records.slice(0, idx), ...records.slice(end)]);
        this.turnDispatcher?.submit(userText, { appendUserRecord: false });
      },
      editAndResend: (id, newContent) => {
        const records = this.messageStore.getSnapshot();
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return;
        this.messageStore.set(records.slice(0, idx));
        this.turnDispatcher?.submit(newContent);
      },
    };
  }
}
