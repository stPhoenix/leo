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
import { HeaderStatsLive } from './chat/HeaderStatsLive';
import { makeContextUsageSource } from './chat/headerStatsSources';
import type { Logger } from '@/platform/Logger';
import { ChatMessageStore } from '@/chat/messageStore';
import { toLegacyContent } from '@/chat/types';
import type { ContentBlock, ToolUseBlock } from '@/chat/types';
import { RunStateStore } from '@/chat/runStateStore';
import { ProgressLines } from './chat/blocks/ProgressLines';
import { DiffView } from './chat/blocks/DiffView';

const EDIT_TOOL_NAMES = new Set([
  'edit_note',
  'create_note',
  'append_to_note',
  'editNote',
  'createNote',
  'appendToNote',
]);
import { StreamingTurnController, type StreamingPhase } from '@/chat/streamingController';
import type { StreamEvent } from '@/agent/streamEvents';
import type { FocusedContextChannel } from '@/editor/focusedContextChannel';
import type { WorkspaceNavigator } from '@/editor/workspaceNavigator';
import type { FocusedContext } from '@/editor/types';
import type { ConfirmationController } from '@/agent/confirmationController';
import type { AcceptRejectController } from '@/agent/acceptRejectController';
import type { PlanApprovalController } from '@/agent/planApprovalController';
import type { ClarifyingQuestionController } from '@/agent/clarifyingQuestionController';
import type { ContextData } from '@/agent/contextAnalyzer';
import type { ContextSnapshotStore } from '@/agent/contextSnapshotStore';
import { resolveContextWindow } from '@/agent/compactConstants';
import { makeInlineConfirmationSource } from './chat/InlineConfirmation';
import { makeAcceptRejectSource } from './chat/InlineDialog';
import { makePlanApprovalSource } from './chat/PlanApprovalDialog';
import { makeClarifyingQuestionSource } from './chat/ClarifyingQuestionDialog';
import type { PlanModeSource } from './chat/planModeSource';
import type { ThreadsSnapshot } from '@/storage/threadsStore';
import { ChatRoot } from './chat/ChatRoot';
import type { MCPClient } from '@/mcp/mcpClient';
import { routeMcpUiAction, type McpUiAction } from '@/mcp/mcpUiActions';
import type { ToolCtx, EditNoteBridge } from '@/tools/types';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { PiiDetectorContext } from './chat/blocks/piiDetectorContext';
import type { PiiDetectAgent } from '@/agent/externalAgent/piiDetectAgent';
import type { CodeBlockClipboard } from './chat/codeBlockEnhancer';
import { TurnDispatcher } from './chat/turnDispatcher';
import type { AttachmentsWiring } from '@/chat/wireAttachments';
import type { CaptureFileInput, AttachmentRejectReason } from '@/chat/attachments';
import type { StagedAttachment } from '@/chat/attachmentsStore';
import type { AttachmentRejection } from './chat/AttachmentRejectedNotice';
import type { VaultFileEntry } from './chat/ComposerInput';
import { createSlashRegistry, type SlashRegistry } from './chat/slashCommands';
import { createContextCommand, type ContextCommandHandle } from './contextCommand';
import { createRagCommand, type RagCommandHandle } from './ragCommand';
import type { RagSnapshot } from '@/rag/ragSnapshot';
import {
  createWikiStatusCommand,
  WIKI_STATUS_WIDGET_KIND,
  type WikiStatusCommandHandle,
} from './wikiStatusCommand';
import type { WikiStatus } from '@/agent/wiki/wikiStatus';
import {
  createCanvasStatusCommand,
  CANVAS_STATUS_WIDGET_KIND,
  type CanvasStatusCommandHandle,
} from './canvasStatusCommand';
import type { CanvasStatus } from '@/agent/canvas/canvasStatus';
import './chat/widgets/ContextWidget';
import './chat/widgets/RagWidget';
import './chat/widgets/WikiStatusWidget';
import './chat/widgets/CanvasStatusWidget';
import type { MessageActions } from './chat/MessageActionBar';
import type { IndexStatusSource } from './chat/IndexStatusBlock';
import type { DrainListener } from '@/indexer/vaultIndexer';
import { VIEW_TYPE_LEO_CHAT } from './viewType';

export interface ChatStreamStarterOptions {
  readonly initialAllowedTools?: readonly string[];
}

export interface ChatStreamStarter {
  (
    prompt: string,
    signal: AbortSignal,
    blocks?: readonly ContentBlock[],
    options?: ChatStreamStarterOptions,
  ): AsyncIterable<StreamEvent>;
}

export interface ChatPlanModeAdapter {
  enter(): void;
  exit?(): void;
}

export interface ThreadsSource {
  readonly subscribe: (cb: () => void) => () => void;
  readonly getSnapshot: () => ThreadsSnapshot;
  readonly create: () => Promise<string>;
  readonly switch: (id: string) => Promise<void>;
  readonly rename: (id: string, title: string) => Promise<void>;
  readonly delete: (id: string) => Promise<void>;
}

export interface ChatViewDeps {
  readonly logger?: Logger;
  readonly messageStore?: ChatMessageStore;
  readonly threadsSource?: ThreadsSource;
  readonly streamStarter?: ChatStreamStarter;
  readonly focusedContext?: FocusedContextChannel;
  readonly workspaceNavigator?: WorkspaceNavigator;
  readonly confirmationController?: ConfirmationController;
  readonly acceptRejectController?: AcceptRejectController;
  readonly planMode?: ChatPlanModeAdapter;
  readonly planModeSource?: PlanModeSource;
  readonly analyzeContext?: (signal: AbortSignal) => Promise<ContextData>;
  readonly contextSnapshot?: ContextSnapshotStore;
  readonly collectRagSnapshot?: (signal: AbortSignal) => Promise<RagSnapshot>;
  readonly collectWikiStatus?: (signal: AbortSignal) => Promise<WikiStatus>;
  readonly collectCanvasStatus?: (signal: AbortSignal) => Promise<CanvasStatus>;
  readonly indexStatusSource?: IndexStatusSource;
  readonly indexDrainSubscribe?: (listener: DrainListener) => () => void;
  readonly onReindexAll?: () => void;
  readonly onReindexChanged?: () => void;
  readonly planApprovalController?: PlanApprovalController;
  readonly clarifyingQuestionController?: ClarifyingQuestionController;
  readonly getContextWindow?: () => number;
  readonly skillSlash?: SkillSlashAdapter;
  readonly compactRunner?: CompactRunnerAdapter;
  readonly attachments?: AttachmentsWiring;
  readonly pickFiles?: () => Promise<readonly CaptureFileInput[]>;
  readonly vaultFiles?: () => readonly VaultFileEntry[];
  readonly readVaultFile?: (path: string) => Promise<CaptureFileInput | null>;
  readonly piiDetector?: PiiDetectAgent;
  readonly clearThreadReadState?: (threadId: string) => void;
  readonly mcpClient?: MCPClient;
  readonly vault?: VaultAdapter;
  readonly editorBridge?: EditNoteBridge;
  readonly subscribeThemeChange?: (cb: () => void) => () => void;
}

export interface CompactRunnerAdapter {
  readonly run: (customInstructions?: string) => Promise<void>;
}

export interface SkillSlashCommandInfo {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
}

export interface SkillSlashRunResult {
  readonly content: string;
  readonly initialAllowedTools?: readonly string[];
}

export interface SkillSlashAdapter {
  readonly list: () => readonly SkillSlashCommandInfo[];
  readonly run: (name: string, args: string) => Promise<SkillSlashRunResult | null>;
}

export class ChatView extends ItemView {
  readonly messageStore: ChatMessageStore;
  readonly runStateStore: RunStateStore = new RunStateStore();
  private root: Root | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly widthListeners = new Set<(w: number) => void>();
  private readonly renderComponents = new Set<Component>();
  private streamingController: StreamingTurnController | null = null;
  private turnDispatcher: TurnDispatcher | null = null;
  private slashRegistry: SlashRegistry | null = null;
  private contextCommand: ContextCommandHandle | null = null;
  private ragCommand: RagCommandHandle | null = null;
  private wikiStatusCommand: WikiStatusCommandHandle | null = null;
  private canvasStatusCommand: CanvasStatusCommandHandle | null = null;
  private liveRegionEl: HTMLElement | null = null;
  private readonly phaseListeners = new Set<(p: StreamingPhase) => void>();
  private lastPhase: StreamingPhase = 'idle';
  private attachmentRejections: AttachmentRejection[] = [];
  private readonly rejectionListeners = new Set<() => void>();
  private attachmentsUnsubscribe: (() => void) | null = null;
  private buildChatRootProps: (() => Parameters<typeof ChatRoot>[0]) | null = null;

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
    liveRegion.dataset.slot = 'stream-live-region';
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
      onEvent: (event) => {
        const rs = this.runStateStore;
        if (event.type === 'block_start' && event.block.type === 'tool_use') {
          rs.markRunning(event.block.id);
          return;
        }
        if (event.type === 'tool_result') {
          const isError = event.result.ok === false;
          rs.markResolved(event.id, isError, event.result);
          return;
        }
        if (event.type === 'progress') {
          rs.appendProgress(event.event.toolUseId, event.event);
          return;
        }
      },
    });
    this.turnDispatcher = new TurnDispatcher({
      messageStore: this.messageStore,
      controller: this.streamingController,
      ...(this.deps.streamStarter !== undefined ? { starter: this.deps.streamStarter } : {}),
    });
    this.slashRegistry = this.buildSlashRegistry();
    const slashList = this.slashRegistry.list();
    this.deps.logger?.info('compact.slash.registry_built', {
      commandCount: slashList.length,
      compactRegistered: slashList.some((c) => c.name === 'compact'),
      hasCompactRunner: this.deps.compactRunner !== undefined,
    });

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
    const clarifyingQuestionSource =
      this.deps.clarifyingQuestionController !== undefined
        ? makeClarifyingQuestionSource(this.deps.clarifyingQuestionController)
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

    const headerStats = this.buildHeaderStats();
    const attachmentsWiring = this.deps.attachments;
    if (attachmentsWiring !== undefined) {
      const unsubscribe = attachmentsWiring.store.subscribe(() => this.requestRender());
      this.attachmentsUnsubscribe = unsubscribe;
    }

    const mcpUiDispatchAction = this.buildMcpUiDispatcher();
    const mcpUiThemeOptions =
      this.deps.subscribeThemeChange !== undefined
        ? { subscribeThemeChange: this.deps.subscribeThemeChange }
        : {};
    const buildProps = (): Parameters<typeof ChatRoot>[0] => ({
      initialWidth: host.clientWidth,
      observeWidth,
      onOverflowMenu: (anchor) => this.openOverflowMenu(anchor),
      messageStore: this.messageStore,
      renderMarkdown,
      clipboard,
      toolUseSlots: this.buildToolUseSlots(),
      liveIndicatorRunState: this.runStateStore,
      lastEventAtSource: () => this.streamingController?.lastEventAt ?? null,
      onCancelLive: () => {
        this.runStateStore.cancelAllInProgress();
        this.streamingController?.stop();
      },
      resolveToolName: (id: string) => this.resolveToolName(id),
      setIcon: (el, name) => setIcon(el, name),
      ...(mcpUiDispatchAction !== null ? { mcpUiDispatchAction, mcpUiThemeOptions } : {}),
      ...(focusedContextSource !== null
        ? {
            contextIndicatorSource: focusedContextSource,
            onRevealContextFile: (path: string) => this.revealFile(path),
          }
        : {}),
      messageActions,
      ...(confirmationSource !== undefined ? { confirmationSource } : {}),
      ...(acceptRejectSource !== undefined ? { acceptRejectSource } : {}),
      ...(this.deps.threadsSource !== undefined ? { threadsSource: this.deps.threadsSource } : {}),
      ...(headerStats !== null ? { headerStats } : {}),
      ...(this.deps.indexStatusSource !== undefined
        ? { indexStatusSource: this.deps.indexStatusSource }
        : {}),
      ...(this.deps.indexDrainSubscribe !== undefined
        ? { indexDrainSubscribe: this.deps.indexDrainSubscribe }
        : {}),
      ...(this.deps.onReindexAll !== undefined ? { onReindexAll: this.deps.onReindexAll } : {}),
      ...(this.deps.onReindexChanged !== undefined
        ? { onReindexChanged: this.deps.onReindexChanged }
        : {}),
      ...(planApprovalSource !== undefined ? { planApprovalSource } : {}),
      ...(clarifyingQuestionSource !== undefined ? { clarifyingQuestionSource } : {}),
      ...(this.deps.planModeSource !== undefined
        ? { planModeSource: this.deps.planModeSource }
        : {}),
      renderPlanMarkdown,
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
          const isCompactSlash = /^\s*\/compact(\s|$)/i.test(text);
          const handled = this.slashRegistry?.tryHandle(text) === true;
          if (isCompactSlash) {
            this.deps.logger?.info('compact.composer.submit_intercept', {
              tryHandleResult: handled,
              hasRegistry: this.slashRegistry !== null,
            });
          }
          if (handled) return;
          this.beginTurn(text);
        },
        onStopIntent: () => {
          this.deps.logger?.info('composer.stop_intent', {});
          this.runStateStore.cancelAllInProgress();
          this.streamingController?.stop();
        },
        onOpenCommandPalette: () => this.openCommandPalette(),
        ...(this.slashRegistry !== null ? { slashCommands: this.slashRegistry.list() } : {}),
        ...(this.deps.attachments !== undefined
          ? {
              attachments: this.attachmentItems(),
              onAttachmentRemove: (id) => this.deps.attachments?.store.remove(id),
              onCaptureFiles: (files) => this.captureAttachmentFiles(files),
              onCaptureRejected: (rejections) => this.appendAttachmentRejections(rejections),
              attachmentRejections: this.attachmentRejections,
              onDismissAttachmentRejections: () => this.clearAttachmentRejections(),
              ...(this.deps.pickFiles !== undefined
                ? { onPickFiles: () => this.openFilePicker() }
                : {}),
              ...(this.deps.vaultFiles !== undefined ? { vaultFiles: this.deps.vaultFiles() } : {}),
              ...(this.deps.readVaultFile !== undefined
                ? { onMentionSelect: (entry) => this.captureMentionedFile(entry.path) }
                : {}),
            }
          : {}),
      },
    });
    this.buildChatRootProps = buildProps;
    this.root = createRoot(host);
    this.root.render(this.renderTree(buildProps()));

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
    this.ragCommand?.cancel();
    this.ragCommand = null;
    this.slashRegistry = null;
    this.attachmentsUnsubscribe?.();
    this.attachmentsUnsubscribe = null;
    this.buildChatRootProps = null;
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

  private beginTurn(
    text: string,
    opts: {
      slashCommand?: { typed: string; command: string };
      initialAllowedTools?: readonly string[];
    } = {},
  ): void {
    const slashCommand = opts.slashCommand;
    const initialAllowedTools = opts.initialAllowedTools;
    const carry = {
      ...(slashCommand !== undefined ? { slashCommand } : {}),
      ...(initialAllowedTools !== undefined && initialAllowedTools.length > 0
        ? { initialAllowedTools }
        : {}),
    };
    const wiring = this.deps.attachments;
    if (wiring === undefined) {
      this.turnDispatcher?.submit(text, carry);
      return;
    }
    const staged = wiring.store.getSnapshot();
    if (staged.length === 0) {
      this.turnDispatcher?.submit(text, carry);
      return;
    }
    const drained = wiring.store.drainForNext();
    const blocks = wiring.buildUserContent(text, drained);
    this.turnDispatcher?.submit(text, {
      blocks,
      ...carry,
    });
  }

  private attachmentItems(): readonly StagedAttachment[] {
    return this.deps.attachments?.store.getSnapshot() ?? [];
  }

  private async captureAttachmentFiles(files: readonly CaptureFileInput[]): Promise<void> {
    const wiring = this.deps.attachments;
    if (wiring === undefined) return;
    const out = wiring.store.capture(files);
    if (out.rejected.length > 0) {
      this.appendAttachmentRejections(
        out.rejected.map((r) => ({
          name: r.name,
          reason: r.reason satisfies AttachmentRejectReason,
        })),
      );
    }
    this.requestRender();
  }

  private async openFilePicker(): Promise<void> {
    const picker = this.deps.pickFiles;
    if (picker === undefined) return;
    const files = await picker();
    if (files.length === 0) return;
    await this.captureAttachmentFiles(files);
  }

  private async captureMentionedFile(path: string): Promise<void> {
    const reader = this.deps.readVaultFile;
    if (reader === undefined) return;
    try {
      const file = await reader(path);
      if (file === null) return;
      await this.captureAttachmentFiles([file]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger?.warn('mention.capture.failure', { path, error: message });
      this.appendAttachmentRejections([{ name: path, reason: { kind: 'upload_failed', message } }]);
    }
  }

  private appendAttachmentRejections(items: readonly AttachmentRejection[]): void {
    if (items.length === 0) return;
    this.attachmentRejections = [...this.attachmentRejections, ...items];
    this.notifyRejections();
    this.requestRender();
  }

  private clearAttachmentRejections(): void {
    if (this.attachmentRejections.length === 0) return;
    this.attachmentRejections = [];
    this.notifyRejections();
    this.requestRender();
  }

  private notifyRejections(): void {
    for (const l of this.rejectionListeners) l();
  }

  private requestRender(): void {
    if (this.root === null || this.buildChatRootProps === null) return;
    this.root.render(this.renderTree(this.buildChatRootProps()));
  }

  private renderTree(props: Parameters<typeof ChatRoot>[0]): ReturnType<typeof createElement> {
    const tree = createElement(ChatRoot, props);
    if (this.deps.piiDetector === undefined) return tree;
    return createElement(PiiDetectorContext.Provider, { value: this.deps.piiDetector }, tree);
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
    const skillSlash = this.deps.skillSlash;
    if (skillSlash !== undefined) {
      for (const cmd of skillSlash.list()) {
        const description =
          cmd.whenToUse !== undefined && cmd.whenToUse.length > 0
            ? `${cmd.description} — ${cmd.whenToUse}`
            : cmd.description;
        registry.register({
          name: cmd.name,
          description,
          match: (ctx) => ctx.name === cmd.name.toLowerCase(),
          run: async (ctx): Promise<void> => {
            const out = await skillSlash.run(cmd.name, ctx.args);
            if (out === null) return;
            this.beginTurn(out.content, {
              slashCommand: { typed: ctx.raw, command: cmd.name },
              ...(out.initialAllowedTools !== undefined && out.initialAllowedTools.length > 0
                ? { initialAllowedTools: out.initialAllowedTools }
                : {}),
            });
          },
        });
      }
    }
    const compact = this.deps.compactRunner;
    if (compact === undefined) {
      this.deps.logger?.info('compact.slash.skipped_no_runner', {});
    }
    if (compact !== undefined) {
      this.deps.logger?.info('compact.slash.registered', {});
      registry.register({
        name: 'compact',
        description: 'Compact conversation now (optional custom instructions)',
        match: (ctx) => ctx.name === 'compact',
        run: async (ctx): Promise<void> => {
          const phase = this.streamingController?.phase;
          if (phase === 'streaming' || phase === 'cancelling') {
            new Notice('Cannot /compact while a turn is streaming.');
            return;
          }
          const args = (ctx.args ?? '').trim();
          try {
            await compact.run(args.length > 0 ? args : undefined);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Compact failed: ${msg}`);
          }
        },
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
    const collectRag = this.deps.collectRagSnapshot;
    if (collectRag !== undefined) {
      this.ragCommand = createRagCommand({
        collect: collectRag,
        render: (snapshot) => this.renderRagAsWidget(snapshot),
        onError: (err) => new Notice(`RAG: ${err.message}`),
        ...(this.deps.logger !== undefined ? { logger: this.deps.logger } : {}),
      });
      const handle = this.ragCommand;
      registry.register({
        name: 'rag',
        description: 'Show RAG / index status',
        run: () => handle.invoke(),
      });
    }
    const collectWikiStatus = this.deps.collectWikiStatus;
    if (collectWikiStatus !== undefined) {
      this.wikiStatusCommand = createWikiStatusCommand({
        collect: collectWikiStatus,
        render: (status) => this.renderWikiStatusAsWidget(status),
        onError: (err) => new Notice(`Wiki status: ${err.message}`),
        ...(this.deps.logger !== undefined ? { logger: this.deps.logger } : {}),
      });
      const handle = this.wikiStatusCommand;
      registry.register({
        name: 'wiki-status',
        description: 'Show wiki health summary',
        run: () => handle.invoke(),
      });
    }
    registry.register({
      name: 'wiki-ingest',
      description: 'Ingest a URL, vault note, or attachment into the wiki',
      run: (ctx) => {
        const args = ctx.args.trim();
        const seed =
          args.length > 0
            ? `Ingest the following into the wiki: ${args}`
            : 'Ingest a knowledge source into the wiki. Ask me for the URL, vault path, or attachment id, then call delegate_wiki_ingest.';
        this.beginTurn(seed);
      },
    });
    registry.register({
      name: 'wiki-lint',
      description: 'Lint the wiki: scan, check, propose fixes',
      run: (ctx) => {
        const args = ctx.args.trim();
        const seed =
          args.length > 0
            ? `Lint the wiki with scope: ${args}`
            : 'Lint the wiki. Call delegate_wiki_lint with the default scope.';
        this.beginTurn(seed);
      },
    });
    const collectCanvasStatus = this.deps.collectCanvasStatus;
    if (collectCanvasStatus !== undefined) {
      this.canvasStatusCommand = createCanvasStatusCommand({
        collect: collectCanvasStatus,
        render: (status) => this.renderCanvasStatusAsWidget(status),
        onError: (err) => new Notice(`Canvas status: ${err.message}`),
        ...(this.deps.logger !== undefined ? { logger: this.deps.logger } : {}),
      });
      const handle = this.canvasStatusCommand;
      registry.register({
        name: 'canvas-status',
        description: 'Show canvas runs + recent canvases',
        run: () => handle.invoke(),
      });
    }
    // /canvas-create is provided by the canvas-create built-in skill (src/skills/builtins.ts)
    // and exposed via skillSlash above. No imperative registration here — the skill body
    // drives the research → plan → delegate workflow.
    registry.register({
      name: 'canvas-edit',
      description: 'Edit content of an existing canvas (add/remove/relabel entities)',
      run: (ctx) => {
        const args = ctx.args.trim();
        const seed =
          args.length > 0
            ? `Edit a canvas: ${args}`
            : 'Edit a canvas. Ask me which canvas to edit and the change to make, then call delegate_canvas_content_edit.';
        this.beginTurn(seed);
      },
    });
    return registry;
  }

  private handleSlashClear(): void {
    this.streamingController?.stop();
    this.streamingController?.dispose();
    this.turnDispatcher?.clear();
    const threads = this.deps.threadsSource;
    if (threads === undefined) {
      this.messageStore.clear();
      this.deps.logger?.info('slash.clear', { mode: 'in-memory' });
      return;
    }
    const oldId = threads.getSnapshot().activeId;
    if (oldId !== null) {
      this.deps.clearThreadReadState?.(oldId);
    }
    void (async (): Promise<void> => {
      try {
        const newId = await threads.create();
        if (oldId !== null && oldId !== newId) {
          await threads.delete(oldId);
        }
        this.deps.logger?.info('slash.clear', { mode: 'rotate', oldId, newId });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.deps.logger?.warn('slash.clear.failed', { error: error.message });
        new Notice(`Clear failed: ${error.message}`);
      }
    })();
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

  triggerRagSlash(): void {
    void this.ragCommand?.invoke();
  }

  private renderRagAsWidget(snapshot: RagSnapshot): void {
    const now = new Date().toISOString();
    this.messageStore.append({
      id: `rag-${Date.now()}`,
      role: 'widget',
      content: '',
      createdAt: now,
      widget: { kind: 'rag', props: { snapshot } },
    });
  }

  private renderWikiStatusAsWidget(status: WikiStatus): void {
    const now = new Date().toISOString();
    this.messageStore.append({
      id: `wiki-status-${Date.now()}`,
      role: 'widget',
      content: '',
      createdAt: now,
      widget: { kind: WIKI_STATUS_WIDGET_KIND, props: { status } },
    });
  }

  private renderCanvasStatusAsWidget(status: CanvasStatus): void {
    const now = new Date().toISOString();
    this.messageStore.append({
      id: `canvas-status-${Date.now()}`,
      role: 'widget',
      content: '',
      createdAt: now,
      widget: { kind: CANVAS_STATUS_WIDGET_KIND, props: { status } },
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

  private buildToolUseSlots(): {
    runState: RunStateStore;
    renderProgress: (block: ToolUseBlock) => JSX.Element;
    renderResult: (block: ToolUseBlock) => JSX.Element | null;
  } {
    const runState = this.runStateStore;
    return {
      runState,
      renderProgress: (block) =>
        createElement(ProgressLines, {
          toolUseId: block.id,
          runState,
        }),
      renderResult: (block) => this.renderEditDiffIfAvailable(block),
    };
  }

  private renderEditDiffIfAvailable(block: ToolUseBlock): JSX.Element | null {
    if (!EDIT_TOOL_NAMES.has(block.name)) return null;
    const result = this.runStateStore.getSnapshot().toolResults.get(block.id);
    if (result?.ok !== true) return null;
    const data = result.data as { before?: unknown; after?: unknown; path?: unknown };
    if (typeof data?.before !== 'string' || typeof data?.after !== 'string') return null;
    return createElement(DiffView, {
      before: data.before,
      after: data.after,
      ...(typeof data.path === 'string' ? { path: data.path } : {}),
    });
  }

  private resolveToolName(id: string): string {
    for (const m of this.messageStore.getSnapshot()) {
      if (m.blocks === undefined) continue;
      for (const b of m.blocks) {
        if (b.type === 'tool_use' && b.id === id) return b.name;
      }
    }
    return id;
  }

  private getActiveThreadIdSafe(): string {
    const ts = this.deps.threadsSource;
    if (ts === undefined) return 'default';
    return ts.getSnapshot().activeId ?? 'default';
  }

  private buildMcpUiDispatcher():
    | ((
        action: McpUiAction,
        serverId: string,
      ) => Promise<{ ok: boolean; error?: string; data?: unknown }>)
    | null {
    const mcpClient = this.deps.mcpClient;
    const confirmation = this.deps.confirmationController;
    const vault = this.deps.vault;
    const editor = this.deps.editorBridge;
    if (mcpClient === undefined || confirmation === undefined) return null;
    if (vault === undefined || editor === undefined) return null;
    const logger = this.deps.logger;
    if (logger === undefined) return null;
    return (action, serverId) => {
      const thread = this.getActiveThreadIdSafe();
      const ctx: ToolCtx = {
        thread,
        signal: this.streamingController?.signal ?? new AbortController().signal,
        vault,
        editor,
        ...(logger !== undefined ? { logger } : {}),
      };
      return routeMcpUiAction(action, {
        serverId,
        thread,
        mcpClient,
        confirmation,
        logger,
        signal: ctx.signal,
        submitPrompt: (text) => this.beginTurn(text),
        openLink: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
        notify: (message) => new Notice(`Leo MCP UI: ${message}`),
        buildToolCtx: () => ctx,
      });
    };
  }

  private buildHeaderStats(): JSX.Element | null {
    const getWindow = this.deps.getContextWindow;
    const snapshot = this.deps.contextSnapshot;
    if (getWindow === undefined || snapshot === undefined) return null;
    const context = makeContextUsageSource(snapshot, getWindow);
    return createElement(HeaderStatsLive, { context });
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
    const nav = this.deps.workspaceNavigator;
    const focus = this.deps.focusedContext?.current() ?? null;
    if (nav !== undefined && focus !== null && focus.file === path && focus.selection !== null) {
      void nav.revealInNote({
        path,
        lineStart: focus.selection.from.line,
        lineEnd: focus.selection.to.line,
        chStart: focus.selection.from.ch,
        chEnd: focus.selection.to.ch,
      });
      return;
    }
    if (nav !== undefined) {
      void nav.openNote(path);
      return;
    }
    void this.app.workspace.openLinkText(path, '', false);
  }

  private buildMessageActions(): MessageActions {
    return {
      copy: async (record) => {
        try {
          await navigator.clipboard.writeText(toLegacyContent(record));
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
