import '@/platform/asyncLocalStorageInit';
import { Notice, Plugin } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { Logger } from '@/platform/Logger';
import { TracerService } from '@/platform/tracer';
import { RotatingFileSink } from '@/platform/rotatingFileSink';
import { createObsidianSinkFs } from '@/platform/obsidianSinkFs';
import { createObsidianUserErrorChannel } from '@/platform/obsidianUserErrorChannel';
import { ProviderManager } from '@/providers/providerManager';
import { EmbeddingClient } from '@/providers/embeddingClient';
import { createProviderForKind } from '@/providers/registry';
import {
  SafeStorage,
  type SecretsPersistence,
  type SafeStorageLike,
  type StoredSecret,
} from '@/storage/safeStorage';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { wireMcp, type McpWiring } from '@/mcp/wireMcp';
import { createSdkTransportFactory } from '@/mcp/sdkTransportFactory';
import { ThreadsStore } from '@/storage/threadsStore';
import { SkillEditorController } from '@/skills/skillEditorController';
import { SettingsStore } from '@/settings/settingsStore';
import { SettingsTab } from '@/settings/SettingsTab';
import { COMMAND_IDS, openLeoSettings, registerLeoCommand } from '@/settings/commands';
import { ChatView } from '@/ui/chatView';
import { VIEW_TYPE_LEO_CHAT } from '@/ui/viewType';
import { openOrFocusChatView } from '@/ui/openChatView';
import { EditorBridge } from '@/editor/editorBridge';
import { FocusedContextChannel } from '@/editor/focusedContextChannel';
import { WorkspaceFocusProbe } from '@/editor/workspaceFocusProbe';
import { AgentRunner } from '@/agent/agentRunner';
import { USE_GRAPH_RUNTIME } from '@/agent/graph';
import type { AgentHistoryMessage, AgentUserMessage } from '@/agent/types';
import { PlanModeController } from '@/agent/planModeController';
import { TodoStore } from '@/agent/todoStore';
import {
  analyzeContextUsage,
  type ContextCounters,
  type ContextData,
} from '@/agent/contextAnalyzer';
import { resolveContextWindow } from '@/agent/compactConstants';
import {
  createContextSnapshotStore,
  type ContextSnapshotStore,
} from '@/agent/contextSnapshotStore';
import { runManualCompaction, type CompactionResult } from '@/agent/autocompact';
import { createTrackingState } from '@/agent/autocompactBreaker';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';
import type { TokenMessage } from '@/agent/tokenEstimator';
import { breakdownMessages } from '@/agent/messageBreakdown';
import { countToolDescriptorTokens, type ToolDescriptor } from '@/agent/toolTokenCount';
import { countSkillFrontmatterTokens } from '@/agent/skillTokenCount';
import { LEO_PREAMBLE, PLAN_MODE_RULE } from '@/prompts/agent/leoPreamble';
import type { ChatMessage } from '@/providers/types';
import { ToolRegistry } from '@/tools/toolRegistry';
import { createReadNoteTool } from '@/tools/builtin/readNote';
import { createToolSearchTool } from '@/tools/toolSearch/toolSearchTool';
import { ToolSearchSession } from '@/agent/toolSearch/toolSearchSession';
import { createListNotesTool } from '@/tools/builtin/listNotes';
import { createReadFileTool } from '@/tools/builtin/readFile';
import { createGlobVaultTool } from '@/tools/builtin/globVault';
import { createGrepVaultTool } from '@/tools/builtin/grepVault';
import { ReadFileStateStore } from '@/tools/builtin/readFileState';
import { compileMatcher, normalizePatterns } from '@/rag/excludeMatcher';
import { createCreateNoteTool } from '@/tools/builtin/createNote';
import { createAppendToNoteTool } from '@/tools/builtin/appendToNote';
import { createCreateFolderTool } from '@/tools/builtin/createFolder';
import { createEditNoteTool } from '@/tools/builtin/editNote';
import { createOpenNoteTool } from '@/tools/builtin/openNote';
import { createRenameNoteTool } from '@/tools/builtin/renameNote';
import { createMoveNoteTool } from '@/tools/builtin/moveNote';
import { createCopyNoteTool } from '@/tools/builtin/copyNote';
import { createDeleteNoteTool } from '@/tools/builtin/deleteNote';
import { createDeleteFolderTool } from '@/tools/builtin/deleteFolder';
import { createRevealInNoteTool } from '@/tools/builtin/revealInNote';
import { createObsidianWorkspaceNavigator } from '@/editor/workspaceNavigator';
import { createObsidianCanvasNavigator } from '@/editor/canvasNavigator';
import { createRevealInCanvasTool } from '@/agent/canvas/tools/revealInCanvas';
import { createDelegateCanvasCreateTool } from '@/agent/canvas/tools/delegateCanvasCreate';
import { createDelegateCanvasContentEditTool } from '@/agent/canvas/tools/delegateCanvasContentEdit';
import { createDelegateCanvasLayoutEditTool } from '@/agent/canvas/tools/delegateCanvasLayoutEdit';
import { CanvasMutex } from '@/agent/canvas/mutex';
import { CanvasOrchestrator } from '@/agent/canvas/orchestrator';
import type { CanvasMetadataCacheLike } from '@/agent/canvas/plan';
import { CanvasPreviewingDispatcher } from '@/agent/canvas/previewingDispatcher';
import type { CanvasPickerDeps } from '@/agent/canvas/widget/widgetController';
import {
  releaseCanvasLiveController,
  CANVAS_LIVE_KIND,
} from '@/agent/canvas/liveControllerRegistry';
import {
  CANVAS_TERMINAL_KIND,
  type CanvasTerminalSnapshot,
} from '@/agent/canvas/widget/terminalSnapshot';
import '@/ui/chat/blocks/CanvasLiveBlock';
import '@/ui/chat/blocks/CanvasTerminalBlock';
import type { ToolSpec } from '@/tools/types';
import { ConfirmationController, prettifyArgs } from '@/agent/confirmationController';
import { AcceptRejectController } from '@/agent/acceptRejectController';
import { SkillsStore } from '@/skills/skillsStore';
import { SkillRegistry, MAIN_AGENT_ID } from '@/skills/registry';
import { createInvokedSkillsStore, type InvokedSkillsStore } from '@/skills/invokedSkills';
import { createSlashProcessor } from '@/skills/slashProcessor';
import { buildSkillListingAttachment } from '@/skills/listingAttachment';
import { createSkillTool } from '@/tools/builtin/skillTool';
import type { ChatStreamStarter, ThreadsSource } from '@/ui/chatView';
import { ChatMessageStore } from '@/chat/messageStore';
import { DEFAULT_THREAD_ID, type ConversationStore } from '@/storage/conversationStore';
import { createObsidianVaultAdapter } from '@/storage/vaultAdapter';
import { purgeOldAttachments } from '@/storage/attachmentsRetention';
import type { StoredMessage } from '@/storage/conversationSchema';
import type { BannerKind, ChatMessageRecord } from '@/chat/types';
import { recordsToAnalyzerInputs } from '@/chat/contextBridge';
import { wireIndexerRag, type AppLike, type IndexerRagWiring } from '@/indexer/wireIndexerRag';
import { bootstrapWiki } from '@/agent/wiki/bootstrap';
import { collectWikiStatus } from '@/agent/wiki/wikiStatus';
import { collectCanvasStatus } from '@/agent/canvas/canvasStatus';
import { WIKI_MUTEX_IDLE } from '@/agent/wiki/mutexTypes';
import { WikiMutex } from '@/agent/wiki/mutex';
import { createWikiBusyNotifier } from '@/agent/wiki/searchWarning';
import { startIngestRun } from '@/agent/wiki/ingest/subgraph';
import {
  createDelegateWikiIngestTool,
  type PickerOutcome,
} from '@/tools/builtin/delegateWikiIngest';
import { createInboxAddTool } from '@/tools/builtin/inboxAdd';
import {
  WIKI_LIVE_KIND,
  registerWikiLiveController,
  releaseWikiLiveController,
} from '@/agent/wiki/liveControllerRegistry';
import { createLlmJsonInvoker } from '@/agent/wiki/ingest/llmAdapter';
import { startLintRun } from '@/agent/wiki/lint/subgraph';
import { createDelegateWikiLintTool } from '@/tools/builtin/delegateWikiLint';
import { createWikiSandbox, restrictedVaultAdapter } from '@/agent/wiki/restrictedVaultAdapter';
import { generateWikiRunId } from '@/agent/wiki/runIdRegistry';
import { WikiWidgetController, type WikiPickerDeps } from '@/agent/wiki/widgetController';
import type { ProviderOverride } from '@/agent/wiki/ingest/types';
import { PROVIDER_KINDS, type ProviderKind } from '@/settings/settingsStore';
import { kindRequiresApiKey } from '@/providers/registry';
import type { ProviderModel } from '@/providers/types';
import { IndexerStatusTap } from '@/indexer/indexerStatusTap';
import { createRagSnapshotCollector, type RagSnapshotCollector } from '@/rag/ragSnapshot';
import { RAG_PALETTE_COMMAND_ID, RAG_PALETTE_COMMAND_NAME } from '@/ui/ragCommand';
import {
  createSearchVaultTool,
  filenameMatch,
  type SearchVaultHit,
} from '@/tools/builtin/searchVault';
import { createSearchWikiTool } from '@/tools/builtin/searchWiki';
import { EditLockController } from '@/editor/editLock';
import { HighlightController } from '@/editor/highlights';
import { createLockDecorationExtension } from '@/editor/cm6LockDecoration';
import {
  createActiveNoteEditBridge,
  type ActiveMarkdownResolver,
  type EditorLike,
} from '@/editor/activeNoteEditBridge';
import { MarkdownView } from 'obsidian';
import { PlanStore } from '@/storage/planStore';
import { PlanApprovalController } from '@/agent/planApprovalController';
import { ClarifyingQuestionController } from '@/agent/clarifyingQuestionController';
import { PlanSessionResume } from '@/agent/planSessionResume';
import { createTodoWriteTool } from '@/tools/todoWriteTool';
import { createEnterPlanModeTool, createExitPlanModeTool } from '@/tools/planModeTools';
import { createAskUserQuestionTool } from '@/tools/builtin/askUserQuestion';
import {
  wireUserTools,
  type UserToolsFileEvents,
  type UserToolsWiring,
} from '@/tools/user/wireUserTools';
import { wireAttachments, type AttachmentsWiring } from '@/chat/wireAttachments';
import type { CaptureFileInput } from '@/chat/attachments';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { SlotManager } from '@/agent/externalAgent/slotManager';
import { ResultWriter } from '@/agent/externalAgent/resultWriter';
import {
  createPassthroughAdapterCallDeps,
  createResultWriterDeps,
} from '@/agent/externalAgent/runPhase';
import { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import { createRefineSubAgent } from '@/agent/externalAgent/refineSubAgent';
import { createPiiDetectAgent } from '@/agent/externalAgent/piiDetectAgent';
import { getRefineSystemPrompt } from '@/prompts/agent/externalAgent/refinePrompt';
import { createDelegateExternalTool } from '@/tools/builtin/delegateExternal';
import {
  EXTERNAL_AGENT_WIDGET_KIND,
  type ExternalAgentTerminalSnapshot,
  buildTerminalSnapshot,
} from '@/agent/externalAgent/terminalSnapshot';
import { ExternalAgentTerminalBlock } from '@/ui/chat/blocks/ExternalAgentTerminalBlock';
import { ExternalAgentLiveBlock } from '@/ui/chat/blocks/ExternalAgentLiveBlock';
import '@/ui/chat/blocks/WikiLiveBlock';
import '@/ui/chat/blocks/WikiTerminalBlock';
import '@/ui/chat/blocks/CompactLiveBlock';
import '@/ui/chat/blocks/CompactTerminalBlock';
import { registerWidget } from '@/ui/chat/widgets/registry';
import {
  COMPACT_LIVE_KIND,
  registerCompactLiveController,
  releaseCompactLiveController,
} from '@/agent/compact/liveControllerRegistry';
import { COMPACT_TERMINAL_KIND } from '@/agent/compact/terminalSnapshot';
import { CompactWidgetController } from '@/agent/compact/widgetController';
import { generateCompactRunId } from '@/agent/compact/runId';
import { makePhaseSinkFromController, type CompactPhaseSink } from '@/agent/compact/phaseSink';
import { isTerminalCompactPhase } from '@/agent/compact/widgetState';
import { resolveAdapterConfig } from '@/settings/externalAgentResolver';
import {
  EXTERNAL_AGENT_LIVE_KIND,
  registerLiveController,
  unregisterLiveController,
} from '@/agent/externalAgent/liveControllerRegistry';
import { ExternalAgentWidgetController } from '@/agent/externalAgent/widgetController';
import {
  SUBAGENT_LIVE_KIND,
  SUBAGENT_TERMINAL_KIND,
  registerTaskLiveController,
  releaseTaskLiveController,
} from '@/agent/task/liveControllerRegistry';
import { SubagentLiveBlock } from '@/ui/chat/blocks/SubagentLiveBlock';
import { SubagentTerminalBlock } from '@/ui/chat/blocks/SubagentTerminalBlock';
import { TaskOrchestrator, type TaskRunHandle } from '@/agent/task/orchestrator';
import type { TaskTerminalSnapshot } from '@/agent/task/terminalSnapshot';
import { buildTaskTerminalSnapshot } from '@/agent/task/terminalSnapshot';
import { TASK_SUBAGENT_PREAMBLE } from '@/prompts/agent/taskSubagentPreamble';
import { createTaskTool } from '@/tools/builtin/task';
import { createOrchestratorUrlFetcher } from '@/agent/wiki/ingest/orchestratorUrlFetcher';
import type { RunHandle as ExternalAgentRunHandle } from '@/agent/externalAgent/subgraph';
import { OpenfangAdapter } from '@/agent/externalAgent/adapters/openfang';
import { createObsidianFetch } from '@/agent/externalAgent/adapters/openfang/obsidianHttpDriver';
import {
  InlineAgentAdapter,
  inlineAgentConfigSchema,
  type ProviderFactory as InlineAgentProviderFactory,
  type ManualChatModelAdapter as InlineAgentManualChatModelAdapter,
  type AssistantStep as InlineAgentAssistantStep,
  type RewriteMessage as InlineAgentRewriteMessage,
  type InlineAgentConfig,
  type InvokeTraceConfig as InlineAgentInvokeTraceConfig,
} from '@/agent/externalAgent/adapters/inlineAgent';
import type { FetchUrlConfig } from '@/agent/externalAgent/adapters/inlineAgent/tools/fetchUrl';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { z } from 'zod';
import {
  fetchUrlInputSchema,
  searchWebInputSchema,
  readFileInputSchema,
  writeFileInputSchema,
  listDirInputSchema,
  deleteFileInputSchema,
  appendFileInputSchema,
  grepInputSchema,
  globInputSchema,
  downloadToFileInputSchema,
  publishArtifactInputSchema,
  extractNoteInputSchema,
  todoWriteInputSchema,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/schemas';
import { defaultEndpointFor } from '@/providers/registry';
import { SAFE_STORAGE_PREFIX } from '@/settings/externalAgentResolver';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic']);

function classifyVaultFile(ext: string): 'image' | 'document' {
  return IMAGE_EXTS.has(ext.toLowerCase()) ? 'image' : 'document';
}

function buildCanvasMetadataCacheAdapter(app: App): CanvasMetadataCacheLike {
  const cache = app.metadataCache;
  return {
    getFileCache: (file) => {
      const tfile = app.vault.getAbstractFileByPath(file.path);
      if (tfile === null || !('extension' in tfile)) return null;
      return cache.getFileCache(tfile as TFile);
    },
    getFirstLinkpathDest: (linkpath, sourcePath) => {
      const dest = cache.getFirstLinkpathDest(linkpath, sourcePath);
      if (dest === null) return null;
      return { path: dest.path };
    },
  };
}

function mimeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    case 'json':
      return 'application/json';
    case 'md':
    case 'txt':
    case 'csv':
    case 'log':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'css':
    case 'html':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function pickFilesViaInput(
  persist?: (name: string, bytes: Uint8Array) => Promise<string | null>,
): Promise<readonly CaptureFileInput[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const files = input.files;
      if (files === null || files.length === 0) {
        resolve([]);
        return;
      }
      const out: CaptureFileInput[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const f = files.item(i);
        if (f === null) continue;
        const buf = await f.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const path = persist !== undefined ? await persist(f.name, bytes) : null;
        out.push({
          name: f.name,
          mimeType: f.type !== '' ? f.type : 'application/octet-stream',
          bytes,
          size: f.size,
          ...(path !== null ? { path } : {}),
        });
      }
      resolve(out);
    });
    input.addEventListener('cancel', () => resolve([]));
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 0);
  });
}
import { wireUiHelpers, type UiHelpersWiring } from '@/ui/wireUiHelpers';
import { wireContextStatusLine, type ContextStatusLineWiring } from '@/ui/wireContextStatusLine';

const LEO_DIR = '.leo';
const LOGS_DIR = '.leo/logs';
const LOG_PATH = '.leo/logs/leo.log';
const ATTACHMENTS_DIR = '.leo/attachments';

function sanitizeAttachmentName(name: string): string {
  const stripped = name
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = stripped.replace(/^\.+/, '');
  return safe.length === 0 ? 'file' : safe.slice(0, 80);
}

function attachmentDateStamp(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function attachmentRandomId(): string {
  return Math.random().toString(36).slice(2, 9); // NOSONAR(typescript:S2245): non-cryptographic filename suffix
}

export default class LeoPlugin extends Plugin {
  store!: SettingsStore;
  logger!: Logger;
  providerManager!: ProviderManager;
  embeddingClient!: EmbeddingClient;
  focusedContext!: FocusedContextChannel;
  agentRunner!: AgentRunner;
  chatMessageStore!: ChatMessageStore;
  conversationStore!: ConversationStore;
  toolRegistry!: ToolRegistry;
  confirmationController!: ConfirmationController;
  acceptRejectController!: AcceptRejectController;
  skillsStore!: SkillsStore;
  todoStore!: TodoStore;
  planModeController!: PlanModeController;
  indexerRag!: IndexerRagWiring;
  editLock!: EditLockController;
  highlightController!: HighlightController;
  workspaceNavigator!: ReturnType<typeof createObsidianWorkspaceNavigator>;
  canvasNavigator!: ReturnType<typeof createObsidianCanvasNavigator>;
  planStore!: PlanStore;
  planApprovalController!: PlanApprovalController;
  clarifyingQuestionController!: ClarifyingQuestionController;
  safeStorage!: SafeStorage;
  tracer!: TracerService;
  mcp: McpWiring | null = null;
  private mcpStartupController: AbortController | null = null;
  threadsStore: ThreadsStore | null = null;
  skillEditor: SkillEditorController | null = null;
  userTools: UserToolsWiring | null = null;
  attachments: AttachmentsWiring | null = null;
  uiHelpers: UiHelpersWiring | null = null;
  contextStatusLine: ContextStatusLineWiring | null = null;
  skillRegistry!: SkillRegistry;
  invokedSkills!: InvokedSkillsStore;
  adapterRegistry!: AdapterRegistry;
  externalAgentSlots!: SlotManager;
  externalAgentOrchestrator!: ExternalAgentOrchestrator;
  taskOrchestrator: TaskOrchestrator | null = null;
  canvasMutex!: CanvasMutex;
  canvasPreviewingDispatcher!: CanvasPreviewingDispatcher;
  canvasOrchestrator!: CanvasOrchestrator;
  private editorBridge!: EditorBridge;
  private indexStatus: {
    hasIndex: () => boolean;
    subscribe: (cb: () => void) => () => void;
  } | null = null;
  private chatStoreUnsub: (() => void) | null = null;
  private contextSnapshot: ContextSnapshotStore | null = null;
  private contextSnapshotUnsub: (() => void) | null = null;
  private contextSnapshotKeepalive: (() => void) | null = null;
  private indexerStatusTap: IndexerStatusTap | null = null;
  private ragCollector: RagSnapshotCollector | null = null;
  private wikiMutex: WikiMutex | null = null;
  private vectorStoreUnavailableReason: string | null = null;
  private vectorStoreCorruptionUnsub: (() => void) | null = null;
  private threadsSubUnsub: (() => void) | null = null;
  private hydrateActiveThread: (() => Promise<void>) | null = null;
  private lastActiveThreadId: string | null = null;
  private sink!: RotatingFileSink;
  private providerStatusEl: HTMLElement | null = null;
  private connectionUnsub: (() => void) | null = null;
  private indexerStatusEl: HTMLElement | null = null;
  private readonly autocompactTracking = createTrackingState();
  private readonly inlineProviderKeys: Record<string, string> = {};
  private readonly inlineTavilyKey: { value: string } = { value: '' };

  private async refreshInlineProviderSecrets(): Promise<void> {
    for (const kind of INLINE_KNOWN_PROVIDER_KINDS) {
      this.inlineProviderKeys[kind] = (await this.safeStorage.get(`provider.${kind}.apiKey`)) ?? '';
    }
    this.inlineTavilyKey.value =
      (await this.safeStorage.get('externalAgents.inline-agent.tavilyApiKey')) ?? '';
  }

  private getActiveThreadId(): string {
    return this.threadsStore?.activeIdOrNull() ?? DEFAULT_THREAD_ID;
  }

  /**
   * Resolve the current inlineAgent `tools.fetchUrl` config from settings.
   * Wiki ingest + canvas create call this lazily on each URL fetch so that
   * `delegate_external` and the wiki/canvas pipelines share a single
   * allowlist/blocklist/timeout policy without a plugin reload.
   *
   * Note: stored config is `Record<string, unknown>` until parsed; we run it
   * through `inlineAgentConfigSchema` so Zod defaults populate any missing
   * fields. Secrets aren't part of the fetchUrl subtree, so no async
   * `safeStorage` walk is needed.
   */
  private resolveInlineAgentFetchUrlConfig(): FetchUrlConfig {
    const stored = this.store.get().externalAgents.adapters['inline-agent']?.config ?? {};
    const parsed = inlineAgentConfigSchema.safeParse(stored);
    const config = parsed.success ? parsed.data : inlineAgentConfigSchema.parse({});
    return config.tools.fetchUrl;
  }

  /**
   * Hook that, for each programmatic `delegate_external` run kicked off by
   * canvas/wiki URL fetching, creates a live widget controller, registers it,
   * and appends a widget block to the chat thread so the user sees and
   * approves the run inline (refine clarification + ready phase + progress).
   * Mirrors the wiring `delegateExternal.ts` uses for chat-side invocations.
   */
  private surfaceExternalAgentWidget(handle: ExternalAgentRunHandle): void {
    const controller = new ExternalAgentWidgetController({
      runId: handle.runId,
      threadId: handle.threadId,
      slots: this.externalAgentSlots,
      registry: this.adapterRegistry,
      findHandle: (id) => this.externalAgentOrchestrator.findHandle(id),
    });
    registerLiveController(handle.runId, controller);
    try {
      this.chatMessageStore.append({
        id: `ea-${handle.runId}`,
        role: 'widget',
        content: '',
        createdAt: new Date().toISOString(),
        widget: {
          kind: EXTERNAL_AGENT_LIVE_KIND,
          props: { runId: handle.runId, threadId: handle.threadId },
        },
      });
    } catch (err) {
      this.logger.warn('externalAgent.live.append-failed', {
        runId: handle.runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  override async onload(): Promise<void> {
    this.store = new SettingsStore(this);
    const settings = await this.store.load();

    const fs = createObsidianSinkFs(this.app.vault.adapter);
    await fs.mkdir(LEO_DIR);
    await fs.mkdir(LOGS_DIR);

    this.sink = new RotatingFileSink(fs, { path: LOG_PATH });
    await this.sink.init();

    const statusEl = this.addStatusBarItem();
    const userChannel = createObsidianUserErrorChannel(statusEl);

    this.logger = new Logger({
      level: settings.logLevel,
      sink: this.sink,
      userChannel,
    });

    const vaultAdapterForSecrets = createObsidianVaultAdapter(this.app.vault.adapter, this.app);

    this.safeStorage = new SafeStorage({
      logger: this.logger,
      persistence: buildSecretsPersistence(vaultAdapterForSecrets),
      electron: resolveElectronSafeStorage(),
      onFallbackNotice: () =>
        new Notice('Leo: OS keyring unavailable — API keys stored with obfuscation only.'),
    });
    await this.safeStorage.load();

    this.tracer = new TracerService({
      safeStorage: this.safeStorage,
      logger: this.logger,
    });
    await this.tracer.refresh(this.store.get());
    this.register(
      this.store.on((next) => {
        void this.tracer.refresh(next);
      }),
    );

    // Read the API key for the *currently selected* provider straight from
    // the SafeStorage in-memory cache on every call. Avoids a stale-cache
    // race: (a) provider swaps would briefly read the previous provider's
    // key, (b) settings-tab edits never refreshed a separate local cache.
    // Both manifested as Google 401 ACCESS_TOKEN_TYPE_UNSUPPORTED — Google
    // received an Anthropic/OpenAI-shaped key.
    const currentApiKey = (): string => {
      const key = `provider.${this.store.get().provider.kind}.apiKey`;
      return this.safeStorage.getCached(key) ?? '';
    };

    const providerCtx = {
      endpoint: (): string => this.store.get().provider.endpoint,
      apiKey: currentApiKey,
    };
    const provider = createProviderForKind(this.store.get().provider.kind, providerCtx);
    const initialTimeouts = this.store.get().providerTimeouts;
    this.providerManager = new ProviderManager({
      provider,
      logger: this.logger,
      firstEventTimeoutMs: initialTimeouts.firstEventMs,
      idleTimeoutMs: initialTimeouts.idleMs,
    });
    this.register(
      this.store.on((next) => {
        const nextKind = next.provider.kind;
        if (nextKind !== this.providerManager.activeProviderId()) {
          const nextProvider = createProviderForKind(nextKind, providerCtx);
          this.providerManager.setProvider(nextProvider);
        }
        this.providerManager.setTimeouts({
          firstEventMs: next.providerTimeouts.firstEventMs,
          idleMs: next.providerTimeouts.idleMs,
        });
      }),
    );
    this.embeddingClient = new EmbeddingClient({
      endpoint: () => this.store.get().provider.endpoint,
      model: () => this.store.get().provider.embeddingModel,
      kind: () => this.store.get().provider.kind,
      apiKey: currentApiKey,
      connection: this.providerManager.connection,
      logger: this.logger,
    });

    this.providerStatusEl = this.addStatusBarItem();
    const renderProviderStatus = (status: 'available' | 'unreachable'): void => {
      if (this.providerStatusEl === null) return;
      this.providerStatusEl.setText(status === 'unreachable' ? 'Leo: LM Studio offline' : '');
      this.providerStatusEl.toggleClass('leo-provider-unreachable', status === 'unreachable');
    };
    renderProviderStatus(this.providerManager.connection.current);
    this.connectionUnsub = this.providerManager.connection.on(renderProviderStatus);

    this.focusedContext = new FocusedContextChannel();
    this.editorBridge = new EditorBridge({
      plugin: this,
      sink: this.focusedContext,
      logger: this.logger,
      probe: new WorkspaceFocusProbe(this.app),
    });
    this.editorBridge.start();

    const vaultAdapter = createObsidianVaultAdapter(this.app.vault.adapter, this.app);
    void this.runAttachmentRetention(vaultAdapter);
    this.toolRegistry = new ToolRegistry({
      logger: this.logger,
      isToolAllowedInPlan: (toolId, thread) => {
        const controller = this.planModeController;
        if (controller === undefined) return true;
        if (controller.getMode(thread) !== 'plan') return true;
        return controller.isToolAllowedInPlan(toolId);
      },
      recordToolBlocked: (thread, toolId) => {
        this.planModeController?.recordToolBlocked(thread, toolId);
      },
    });
    this.acceptRejectController = new AcceptRejectController();
    this.externalAgentSlots = new SlotManager();
    this.adapterRegistry = new AdapterRegistry({
      defaultIdSource: () => this.store.get().externalAgents.defaultAdapterId,
      enabledSource: () => {
        const map: Record<string, boolean> = {};
        for (const [id, cfg] of Object.entries(this.store.get().externalAgents.adapters)) {
          map[id] = cfg.enabled;
        }
        return map;
      },
    });
    await this.refreshInlineProviderSecrets();
    this.register(
      this.store.on(() => {
        void this.refreshInlineProviderSecrets();
      }),
    );
    const inlineAgentProviderFactory: InlineAgentProviderFactory = (providerId, model, opts) =>
      buildInlineChatModel({
        providerId,
        model,
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
        endpoint: resolveInlineEndpoint(providerId, this.store),
        apiKey: this.inlineProviderKeys[providerId] ?? '',
      });
    const tracerRef = this.tracer;
    this.adapterRegistry.register(
      new InlineAgentAdapter({
        providerFactory: inlineAgentProviderFactory,
        logger: this.logger,
        chatModelAdapter: bindInlineChatModelAdapter,
        resolveSearchWebApiKey: (config) =>
          resolveInlineSearchWebKey(config, this.inlineTavilyKey.value),
        beginTurn: ({ sessionId, runId }) => {
          if (tracerRef?.isEnabled() !== true) return null;
          const handle = tracerRef.beginTurn({
            sessionId,
            metadata: { runId, agentId: 'inline-agent' },
            tags: ['leo', 'agent:inline-agent'],
            name: 'leo.inline-agent.turn',
          });
          const callbacks = handle.traceContext.callbacks;
          return {
            traceConfig: {
              ...(callbacks !== undefined ? { callbacks } : {}),
              metadata: handle.traceContext.metadata,
              tags: handle.traceContext.tags,
            },
            end: () => handle.end(),
          };
        },
      }),
    );
    this.adapterRegistry.register(new OpenfangAdapter({ fetchImpl: createObsidianFetch() }));
    this.toolRegistry.register(createReadNoteTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(createListNotesTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(createReadFileTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(createGlobVaultTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(createGrepVaultTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(
      createCreateNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createAppendToNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(createCreateFolderTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(
      createRenameNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createMoveNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createCopyNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createDeleteNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createDeleteFolderTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.editLock = new EditLockController({
      logger: this.logger,
      onBlockedKeystroke: () => new Notice('Leo: range is locked — wait for edit to finish.'),
    });
    this.highlightController = new HighlightController({ logger: this.logger });
    const resolver: ActiveMarkdownResolver = {
      resolve: (path) => {
        const leaves = this.app.workspace.getLeavesOfType('markdown');
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.file?.path === path) {
            return view.editor as unknown as EditorLike;
          }
        }
        return null;
      },
    };
    const editBridge = createActiveNoteEditBridge({
      resolver,
      lock: this.editLock,
      highlights: this.highlightController,
      logger: this.logger,
    });
    this.registerEditorExtension(
      createLockDecorationExtension({
        lock: this.editLock,
        highlights: this.highlightController,
      }),
    );
    this.toolRegistry.register(
      createEditNoteTool({
        acceptReject: this.acceptRejectController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.workspaceNavigator = createObsidianWorkspaceNavigator({
      app: this.app,
      highlights: this.highlightController,
      logger: this.logger,
    });
    this.canvasNavigator = createObsidianCanvasNavigator({
      app: this.app,
      logger: this.logger,
    });
    this.canvasMutex = new CanvasMutex();
    this.canvasPreviewingDispatcher = new CanvasPreviewingDispatcher();
    this.toolRegistry.register(createOpenNoteTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(createRevealInNoteTool() as unknown as ToolSpec<unknown, unknown>);
    this.toolRegistry.register(createRevealInCanvasTool() as unknown as ToolSpec<unknown, unknown>);
    this.skillsStore = new SkillsStore({
      vault: vaultAdapter,
      logger: this.logger,
      noticeChannel: { notify: (msg) => new Notice(msg) },
    });
    await this.skillsStore.loadAll();

    this.skillRegistry = new SkillRegistry({
      store: this.skillsStore,
      logger: this.logger,
    });
    this.invokedSkills = createInvokedSkillsStore();
    const slashProcessor = createSlashProcessor({
      registry: this.skillRegistry,
      invoked: this.invokedSkills,
      logger: this.logger,
    });
    this.toolRegistry.register(
      createSkillTool({
        registry: this.skillRegistry,
        processor: slashProcessor,
        resolveAgentId: () => MAIN_AGENT_ID,
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    this.skillEditor = new SkillEditorController({
      store: this.skillsStore,
      logger: this.logger,
      notice: { notify: (msg) => new Notice(msg) },
    });

    this.chatMessageStore = new ChatMessageStore();
    const agentHistory = new Map<string, AgentHistoryMessage[]>();
    let suspendPersist = false;
    this.chatStoreUnsub = this.chatMessageStore.subscribe(() => {
      if (suspendPersist) return;
      const snapshot = this.chatMessageStore.getSnapshot();
      this.conversationStore.mutate((prev) => ({
        ...prev,
        messages: recordsToStored(snapshot),
      }));
    });

    this.contextSnapshot = createContextSnapshotStore({
      analyze: (signal) => this.analyzeContextForChat(signal ?? new AbortController().signal),
      onError: (err) =>
        this.logger.warn('context.snapshot_failed', {
          error: err instanceof Error ? err.message : String(err),
        }),
    });
    this.contextSnapshotKeepalive = this.contextSnapshot.subscribe(() => {});
    this.contextSnapshotUnsub = this.chatMessageStore.subscribe(() => {
      this.contextSnapshot?.refresh();
    });
    this.hydrateActiveThread = async (): Promise<void> => {
      if (this.threadsStore === null) return;
      const active = await this.threadsStore.active();
      this.conversationStore = active;
      const thread = active.getThread();
      suspendPersist = true;
      try {
        this.chatMessageStore.set(storedToRecords(thread.messages));
      } finally {
        suspendPersist = false;
      }
      agentHistory.set(this.getActiveThreadId(), deriveAgentHistory(thread.messages));
    };

    this.confirmationController = new ConfirmationController();
    this.todoStore = new TodoStore();
    this.planModeController = new PlanModeController({
      logger: this.logger,
      todoStore: this.todoStore,
    });
    this.planStore = new PlanStore({ vault: vaultAdapter, logger: this.logger });
    this.planApprovalController = new PlanApprovalController();
    this.clarifyingQuestionController = new ClarifyingQuestionController();

    const externalResultWriter = new ResultWriter({
      vault: vaultAdapter,
      logger: this.logger,
    });
    registerWidget(EXTERNAL_AGENT_WIDGET_KIND, ExternalAgentTerminalBlock);
    registerWidget(EXTERNAL_AGENT_LIVE_KIND, ExternalAgentLiveBlock);
    const persistExternalAgentSnapshot = (snapshot: ExternalAgentTerminalSnapshot): void => {
      try {
        const id = `ea-${snapshot.runId}`;
        const existing = this.chatMessageStore.getSnapshot().find((m) => m.id === id);
        if (existing !== undefined) {
          this.chatMessageStore.update(id, (prev) => ({
            ...prev,
            widget: { kind: EXTERNAL_AGENT_WIDGET_KIND, props: snapshot },
          }));
        } else {
          this.chatMessageStore.append({
            id,
            role: 'widget',
            content: '',
            createdAt: new Date().toISOString(),
            widget: { kind: EXTERNAL_AGENT_WIDGET_KIND, props: snapshot },
          });
        }
        unregisterLiveController(snapshot.runId);
      } catch (err) {
        this.logger.warn('externalAgent.persist.append-failed', {
          runId: snapshot.runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    this.externalAgentOrchestrator = new ExternalAgentOrchestrator({
      registry: this.adapterRegistry,
      slots: this.externalAgentSlots,
      refine: createRefineSubAgent({
        provider: this.providerManager,
        model: () => this.store.get().provider.chatModel,
        temperature: () => this.store.get().provider.temperature,
        logger: this.logger,
      }),
      adapterCall: createPassthroughAdapterCallDeps(),
      writer: createResultWriterDeps(externalResultWriter),
      systemPrompt: getRefineSystemPrompt(),
      logger: this.logger,
      resolveConfig: async (adapterId) =>
        resolveAdapterConfig({
          storedConfig: this.store.get().externalAgents.adapters[adapterId]?.config ?? {},
          safeStorage: this.safeStorage,
          adapterId,
        }),
      persistSnapshot: persistExternalAgentSnapshot,
      beginTrace: ({ runId, threadId }) => {
        if (!this.tracer.isEnabled()) return null;
        const handle = this.tracer.beginTurn({
          sessionId: threadId,
          metadata: { runId, agentId: 'external-agent' },
          tags: ['leo', 'agent:external-agent'],
          name: 'leo.external-agent.run',
        });
        const ctx = handle.traceContext;
        return {
          traceConfig: {
            ...(ctx.callbacks !== undefined ? { callbacks: ctx.callbacks } : {}),
            metadata: ctx.metadata,
            tags: ctx.tags,
          },
          end: () => handle.end(),
        };
      },
    });
    this.toolRegistry.register(
      createDelegateExternalTool({
        orchestrator: this.externalAgentOrchestrator,
        confirmation: this.confirmationController,
        onHandle: (handle) => {
          const controller = new ExternalAgentWidgetController({
            runId: handle.runId,
            threadId: handle.threadId,
            slots: this.externalAgentSlots,
            registry: this.adapterRegistry,
            findHandle: (id) => this.externalAgentOrchestrator.findHandle(id),
          });
          registerLiveController(handle.runId, controller);
          try {
            this.chatMessageStore.append({
              id: `ea-${handle.runId}`,
              role: 'widget',
              content: '',
              createdAt: new Date().toISOString(),
              widget: {
                kind: EXTERNAL_AGENT_LIVE_KIND,
                props: { runId: handle.runId, threadId: handle.threadId },
              },
            });
          } catch (err) {
            this.logger.warn('externalAgent.live.append-failed', {
              runId: handle.runId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    registerWidget(SUBAGENT_LIVE_KIND, SubagentLiveBlock);
    registerWidget(SUBAGENT_TERMINAL_KIND, SubagentTerminalBlock);
    const persistTaskSnapshot = (snapshot: TaskTerminalSnapshot): void => {
      try {
        const id = `task-${snapshot.runId}`;
        const existing = this.chatMessageStore.getSnapshot().find((m) => m.id === id);
        if (existing !== undefined) {
          this.chatMessageStore.update(id, (prev) => ({
            ...prev,
            widget: { kind: SUBAGENT_TERMINAL_KIND, props: snapshot },
          }));
        } else {
          this.chatMessageStore.append({
            id,
            role: 'widget',
            content: '',
            createdAt: new Date().toISOString(),
            widget: { kind: SUBAGENT_TERMINAL_KIND, props: snapshot },
          });
        }
        releaseTaskLiveController(snapshot.runId);
      } catch (err) {
        this.logger.warn('task.persist.append-failed', {
          runId: snapshot.runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    this.taskOrchestrator = new TaskOrchestrator({
      buildGraphDeps: () => this.agentRunner.buildGraphDepsForSubagent(),
      confirmation: this.confirmationController,
      subagentPreamble: TASK_SUBAGENT_PREAMBLE,
      logger: this.logger,
      persistSnapshot: persistTaskSnapshot,
    });
    this.toolRegistry.register(
      createTaskTool({
        orchestrator: this.taskOrchestrator,
        confirmation: this.confirmationController,
        onHandle: (handle: TaskRunHandle) => {
          registerTaskLiveController(handle.runId, handle.controller);
          try {
            this.chatMessageStore.append({
              id: `task-${handle.runId}`,
              role: 'widget',
              content: '',
              createdAt: new Date().toISOString(),
              widget: {
                kind: SUBAGENT_LIVE_KIND,
                props: {
                  runId: handle.runId,
                  threadId: handle.threadId,
                  prompt: handle.controller.viewModel().prompt,
                },
              },
            });
          } catch (err) {
            this.logger.warn('task.live.append-failed', {
              runId: handle.runId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        },
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    const persistCanvasSnapshot = (snapshot: CanvasTerminalSnapshot): void => {
      try {
        const id = `canvas-${snapshot.runId}`;
        const existing = this.chatMessageStore.getSnapshot().find((m) => m.id === id);
        if (existing !== undefined) {
          this.chatMessageStore.update(id, (prev) => ({
            ...prev,
            widget: { kind: CANVAS_TERMINAL_KIND, props: snapshot },
          }));
        } else {
          this.chatMessageStore.append({
            id,
            role: 'widget',
            content: '',
            createdAt: new Date().toISOString(),
            widget: { kind: CANVAS_TERMINAL_KIND, props: snapshot },
          });
        }
        releaseCanvasLiveController(snapshot.runId);
      } catch (err) {
        this.logger.warn('canvas.persist.append-failed', {
          runId: snapshot.runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    const listModelsForProvider = async (
      providerId: ProviderKind,
      signal: AbortSignal,
    ): Promise<readonly ProviderModel[]> => {
      const provider = createProviderForKind(providerId, {
        endpoint: () => resolveInlineEndpoint(providerId, this.store),
        apiKey: () => this.inlineProviderKeys[providerId] ?? '',
      });
      return provider.listModels(signal);
    };
    const sharedPickerDeps: CanvasPickerDeps = {
      listModelsForProvider,
      requiresApiKey: (providerId) => kindRequiresApiKey(providerId),
      hasApiKey: (providerId) => (this.inlineProviderKeys[providerId] ?? '').length > 0,
    };
    this.canvasOrchestrator = new CanvasOrchestrator({
      subgraph: {
        mutex: this.canvasMutex,
        vault: vaultAdapter,
        metadataCache: buildCanvasMetadataCacheAdapter(this.app),
        provider: this.providerManager,
        model: () => this.store.get().provider.chatModel,
        maxTokens: () => this.store.get().provider.maxTokens,
        ...(this.store.get().provider.temperature !== undefined
          ? { temperature: () => this.store.get().provider.temperature ?? 0 }
          : {}),
        previewing: this.canvasPreviewingDispatcher,
        logger: this.logger,
        url: () => this.resolveInlineAgentFetchUrlConfig(),
        urlFetcher: createOrchestratorUrlFetcher({
          orchestrator: this.externalAgentOrchestrator,
          vault: vaultAdapter,
          threadId: () => this.getActiveThreadId(),
          onHandle: (handle) => this.surfaceExternalAgentWidget(handle),
          logger: this.logger,
        }),
      },
      logger: this.logger,
      beginTrace: ({ runId, threadId, op }) => {
        if (!this.tracer.isEnabled()) return null;
        const handle = this.tracer.beginTurn({
          sessionId: threadId,
          metadata: { runId, op: `canvas.${op}` },
          tags: ['leo', `canvas:${op}`],
          name: `leo.canvas.${op}.run`,
        });
        const ctx = handle.traceContext;
        return {
          traceConfig: {
            ...(ctx.callbacks !== undefined ? { callbacks: ctx.callbacks } : {}),
            metadata: ctx.metadata,
            tags: ctx.tags,
          },
          end: () => handle.end(),
        };
      },
      picker: {
        deps: sharedPickerDeps,
        buildInit: ({ originalAsk, targetPath }) => {
          const s = this.store.get();
          return {
            providers: PROVIDER_KINDS,
            defaultProviderId: s.provider.kind,
            defaultModel: s.provider.chatModel,
            defaultPreset: 'auto' as const,
            defaultPath: targetPath,
            originalAsk,
          };
        },
        applyOverride: (sub, override) => ({
          ...sub,
          provider: createProviderForKind(override.providerId, {
            endpoint: () => resolveInlineEndpoint(override.providerId, this.store),
            apiKey: () => this.inlineProviderKeys[override.providerId] ?? '',
          }),
          model: () => override.model,
        }),
      },
      appendWidgetBlock: ({ runId, threadId, op, targetPath, originalAsk }) => {
        this.chatMessageStore.append({
          id: `canvas-live-${runId}`,
          role: 'widget',
          content: '',
          createdAt: new Date().toISOString(),
          widget: {
            kind: CANVAS_LIVE_KIND,
            props: { runId, threadId, op, targetPath, originalAsk },
          },
        });
      },
      resolvePreviewing: (runId, action) => {
        this.canvasPreviewingDispatcher.resolve(runId, action);
      },
      openPreview: (path) => {
        void this.canvasNavigator.openCanvas(path).catch((err) => {
          this.logger.warn('canvas.openPreview.failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      persistSnapshot: persistCanvasSnapshot,
    });
    this.toolRegistry.register(
      createDelegateCanvasCreateTool({
        orchestrator: this.canvasOrchestrator,
        confirmation: this.confirmationController,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createDelegateCanvasContentEditTool({
        orchestrator: this.canvasOrchestrator,
        confirmation: this.confirmationController,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createDelegateCanvasLayoutEditTool({
        orchestrator: this.canvasOrchestrator,
        confirmation: this.confirmationController,
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    const wikiLlmInvoker = createLlmJsonInvoker({
      chatModel: () => {
        const s = this.store.get();
        return buildInlineChatModel({
          providerId: s.provider.kind,
          model: s.provider.chatModel,
          endpoint: resolveInlineEndpoint(s.provider.kind, this.store),
          apiKey: this.inlineProviderKeys[s.provider.kind] ?? '',
          ...(s.provider.temperature !== undefined ? { temperature: s.provider.temperature } : {}),
        });
      },
    });
    const wikiContextWindow = (): number => {
      const s = this.store.get();
      return resolveContextWindow({
        model: s.provider.chatModel,
        ...(s.contextWindowOverride !== undefined ? { userOverride: s.contextWindowOverride } : {}),
      });
    };
    const wikiMaxOutputTokens = (): number => this.store.get().provider.maxTokens;

    const wikiSandbox = createWikiSandbox();
    const wikiVault = restrictedVaultAdapter(vaultAdapter, wikiSandbox.allow);

    const buildWikiOverrideInvoker = (override: ProviderOverride) =>
      createLlmJsonInvoker({
        chatModel: () => {
          const s = this.store.get();
          return buildInlineChatModel({
            providerId: override.providerId,
            model: override.model,
            endpoint: resolveInlineEndpoint(override.providerId, this.store),
            apiKey: this.inlineProviderKeys[override.providerId] ?? '',
            ...(s.provider.temperature !== undefined
              ? { temperature: s.provider.temperature }
              : {}),
          });
        },
      });

    const wikiPickerDeps: WikiPickerDeps = sharedPickerDeps;

    const beginWikiPickerFlow = async (args: {
      readonly threadId: string;
      readonly originalAsk: string;
      readonly sourcesSummary: string;
      readonly op: 'ingest' | 'lint';
    }): Promise<PickerOutcome | null> => {
      const runId = generateWikiRunId({});
      const controller = new WikiWidgetController({
        runId,
        threadId: args.threadId,
        op: args.op,
      });
      registerWikiLiveController(runId, controller);
      try {
        this.chatMessageStore.append({
          id: `wiki-${args.op}-${runId}`,
          role: 'widget',
          content: '',
          createdAt: new Date().toISOString(),
          widget: {
            kind: WIKI_LIVE_KIND,
            props: { runId, threadId: args.threadId, op: args.op },
          },
        });
      } catch (err) {
        this.logger.warn(`wiki.${args.op}.live.append-failed`, {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const s = this.store.get();
      const override = await controller.startConfigPhase(wikiPickerDeps, {
        providers: PROVIDER_KINDS,
        defaultProviderId: s.provider.kind,
        defaultModel: s.provider.chatModel,
        originalAsk: args.originalAsk,
        sourcesSummary: args.sourcesSummary,
      });
      if (override === null) {
        controller.setPhase('cancelled');
        releaseWikiLiveController(runId);
        return null;
      }
      return { override, runId, controller };
    };

    this.toolRegistry.register(
      createDelegateWikiIngestTool({
        vault: wikiVault,
        beginPickerFlow: (args) => beginWikiPickerFlow({ ...args, op: 'ingest' }),
        isAllowedVaultPath: wikiSandbox.allow,
        inbox: { vault: wikiVault, logger: this.logger },
        startRun: (input, runId, controller) => {
          const turn = this.tracer.isEnabled()
            ? this.tracer.beginTurn({
                sessionId: input.threadId,
                metadata: { runId, op: 'wiki.ingest' },
                tags: ['leo', 'wiki:ingest'],
                name: 'leo.wiki.ingest.run',
              })
            : null;
          const traceConfig =
            turn !== null
              ? {
                  ...(turn.traceContext.callbacks !== undefined
                    ? { callbacks: turn.traceContext.callbacks }
                    : {}),
                  metadata: turn.traceContext.metadata,
                  tags: turn.traceContext.tags,
                }
              : undefined;
          const result = startIngestRun(input, {
            vault: wikiVault,
            mutex: this.wikiMutex!,
            logger: this.logger,
            llm:
              input.providerOverride !== undefined
                ? buildWikiOverrideInvoker(input.providerOverride)
                : wikiLlmInvoker,
            fetch: {
              url: () => this.resolveInlineAgentFetchUrlConfig(),
              urlFetcher: createOrchestratorUrlFetcher({
                orchestrator: this.externalAgentOrchestrator,
                vault: vaultAdapter,
                threadId: () => input.threadId,
                onHandle: (handle) => this.surfaceExternalAgentWidget(handle),
                logger: this.logger,
              }),
            },
            requestDuplicateChoice: async () => 'skip',
            contextWindow: wikiContextWindow(),
            maxOutputTokens: wikiMaxOutputTokens(),
            existingRunId: runId,
            existingController: controller,
            ...(traceConfig !== undefined ? { traceConfig } : {}),
          });
          if (turn !== null) {
            if (result.ok) {
              const wrappedTerminal = result.handle.terminal.finally(() => turn.end());
              return { ok: true, handle: { ...result.handle, terminal: wrappedTerminal } };
            }
            void turn.end();
          }
          return result;
        },
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    this.toolRegistry.register(
      createInboxAddTool({ vault: vaultAdapter }) as unknown as ToolSpec<unknown, unknown>,
    );

    this.toolRegistry.register(
      createDelegateWikiLintTool({
        beginPickerFlow: (args) => beginWikiPickerFlow({ ...args, op: 'lint' }),
        startRun: (input, runId, controller, requestConfirmation) => {
          const turn = this.tracer.isEnabled()
            ? this.tracer.beginTurn({
                sessionId: input.threadId,
                metadata: { runId, op: 'wiki.lint' },
                tags: ['leo', 'wiki:lint'],
                name: 'leo.wiki.lint.run',
              })
            : null;
          const traceConfig =
            turn !== null
              ? {
                  ...(turn.traceContext.callbacks !== undefined
                    ? { callbacks: turn.traceContext.callbacks }
                    : {}),
                  metadata: turn.traceContext.metadata,
                  tags: turn.traceContext.tags,
                }
              : undefined;
          const result = startLintRun(input, {
            vault: wikiVault,
            mutex: this.wikiMutex!,
            llm:
              input.providerOverride !== undefined
                ? buildWikiOverrideInvoker(input.providerOverride)
                : wikiLlmInvoker,
            logger: this.logger,
            requestConfirmation,
            contextWindow: wikiContextWindow(),
            maxOutputTokens: wikiMaxOutputTokens(),
            existingRunId: runId,
            existingController: controller,
            ...(traceConfig !== undefined ? { traceConfig } : {}),
          });
          if (turn !== null) {
            if (result.ok) {
              const wrappedTerminal = result.handle.terminal.finally(() => turn.end());
              return { ok: true, handle: { ...result.handle, terminal: wrappedTerminal } };
            }
            void turn.end();
          }
          return result;
        },
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    this.toolRegistry.register(
      createTodoWriteTool({
        store: this.todoStore,
        keyFor: ({ thread, agentId }) =>
          agentId !== undefined && agentId.length > 0 ? agentId : thread,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createEnterPlanModeTool({
        controller: this.planModeController,
        planStore: this.planStore,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createExitPlanModeTool({
        controller: this.planModeController,
        planStore: this.planStore,
        approval: this.planApprovalController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );
    this.toolRegistry.register(
      createAskUserQuestionTool({
        controller: this.clarifyingQuestionController,
        logger: this.logger,
      }) as unknown as ToolSpec<unknown, unknown>,
    );

    try {
      this.threadsStore = new ThreadsStore({
        adapter: vaultAdapter,
        logger: this.logger,
        onNotify: (msg, action) => {
          if (action === undefined) {
            new Notice(msg);
            return;
          }
          const fragment = document.createDocumentFragment();
          fragment.appendChild(document.createTextNode(`${msg} · `));
          const btn = document.createElement('a');
          btn.textContent = action.label;
          btn.style.cursor = 'pointer';
          btn.addEventListener('click', () => action.run());
          fragment.appendChild(btn);
          new Notice(fragment, 10_000);
        },
      });
      await this.threadsStore.init();
      this.lastActiveThreadId = this.threadsStore.activeIdOrNull();
      await this.hydrateActiveThread?.();
      this.threadsSubUnsub = this.threadsStore.subscribe(() => {
        const next = this.threadsStore?.activeIdOrNull() ?? null;
        if (next === this.lastActiveThreadId) return;
        this.lastActiveThreadId = next;
        void this.hydrateActiveThread?.();
      });
    } catch (err) {
      this.logger.warn('threads.wire.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      this.mcpStartupController = new AbortController();
      this.mcp = await wireMcp({
        logger: this.logger,
        vault: vaultAdapter,
        toolRegistry: this.toolRegistry,
        safeStorage: this.safeStorage,
        transportFactory: createSdkTransportFactory({ logger: this.logger }),
        startupRetry: {
          signal: this.mcpStartupController.signal,
          notifier: (failure): void => {
            new Notice(
              `MCP server "${failure.serverId}" failed to connect after ${failure.attempts} attempts: ${failure.error}`,
              10_000,
            );
          },
        },
      });
      void this.mcp.connectAll();
    } catch (err) {
      this.logger.warn('mcp.wire.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const settingsTab = new SettingsTab(this.app, this, {
      store: this.store,
      providerManager: this.providerManager,
      logger: this.logger,
      safeStorage: this.safeStorage,
      skillsStore: this.skillsStore,
      skillEditor: this.skillEditor ?? undefined,
      mcpSettingsStore: this.mcp?.settingsStore,
      mcpClient: this.mcp?.client,
      tracer: this.tracer,
      adapterRegistry: this.adapterRegistry,
      refreshInlineProviderSecrets: () => this.refreshInlineProviderSecrets(),
    });
    this.addSettingTab(settingsTab);

    try {
      const resume = new PlanSessionResume({
        todoStore: this.todoStore,
        planStore: this.planStore,
        vault: vaultAdapter,
        logger: this.logger,
      });
      const storedThread = this.conversationStore.getThread();
      await resume.resume(storedThread);
    } catch (err) {
      this.logger.warn('plan.resume.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.indexerStatusEl = this.addStatusBarItem();
    this.indexerRag = await wireIndexerRag({
      app: this.app as unknown as AppLike,
      plugin: this,
      vaultAdapter,
      embeddingClient: this.embeddingClient,
      logger: this.logger,
      excludePatterns: () => this.store.get().indexing.excludePatterns,
      embeddingModel: () => this.store.get().provider.embeddingModel,
      chatProviderReady: () => this.providerManager.connection.current === 'available',
      statusBarEl: this.indexerStatusEl,
      promptHeaderMismatch: async () => {
        new Notice('Leo: index model changed — re-index from settings when ready.');
        return 'later';
      },
      confirmReindex: async () => {
        new Notice('Leo: re-indexing vault…');
        return 'reindex';
      },
      confirmModelSwitch: async () => 'later',
    });

    this.indexerStatusTap = new IndexerStatusTap({
      subscribe: (l) => this.indexerRag.vaultIndexer.subscribe(l),
    });
    this.vectorStoreCorruptionUnsub = this.indexerRag.vectorStore.subscribe((event) => {
      if (event.kind === 'corruption') {
        this.vectorStoreUnavailableReason = event.reason;
      }
    });
    this.ragCollector = createRagSnapshotCollector({
      getVectorStore: () => this.indexerRag.vectorStore,
      getIndexerStatus: () => this.indexerStatusTap!,
      getGraphCache: () => this.indexerRag.graphCache,
      getExcludeStore: () => this.indexerRag.excludeStore,
      getEmbeddingModel: () => this.store.get().provider.embeddingModel,
      getStoreUnavailableReason: () => this.vectorStoreUnavailableReason,
      logger: this.logger,
    });

    try {
      await bootstrapWiki({
        vault: vaultAdapter,
        excludeStore: this.indexerRag.excludeStore,
        logger: this.logger,
      });
    } catch (err) {
      this.logger.warn('wiki.bootstrap.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.wikiMutex = new WikiMutex({ logger: this.logger });

    this.app.workspace.onLayoutReady(() => {
      void this.indexerRag.vaultIndexer.init().catch((err) => {
        this.logger.warn('indexer.init.failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    const settingsUnsub = this.store.on((next) => {
      void this.indexerRag.excludeStore.set(next.indexing.excludePatterns);
    });
    this.register(settingsUnsub);

    this.indexStatus = this.buildIndexStatusSource();
    const searchVaultTool = createSearchVaultTool({
      query: async (text, opts) => {
        const hits = await this.indexerRag.ragEngine.query(text, {
          ...(opts?.tags !== undefined ? { tags: opts.tags } : {}),
          ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
        });
        if (hits.length > 0) return { hits: hits as readonly SearchVaultHit[] };
        if (this.indexStatus?.hasIndex() === true) {
          return { hits: [] };
        }
        const fallback = await filenameMatch(vaultAdapter, text, opts?.signal);
        return {
          hits: fallback,
          notice:
            'Vault is not indexed; results are filename matches only. Run "Index vault" for semantic search.',
        };
      },
    });
    this.toolRegistry.register(searchVaultTool as unknown as ToolSpec<unknown, unknown>);

    const wikiBusyNotifier = createWikiBusyNotifier({
      notify: (msg) => new Notice(msg),
    });
    const searchWikiTool = createSearchWikiTool({
      vault: vaultAdapter,
      getMutexState: () => this.wikiMutex?.active() ?? WIKI_MUTEX_IDLE,
      notifyBusy: wikiBusyNotifier,
    });
    this.toolRegistry.register(searchWikiTool as unknown as ToolSpec<unknown, unknown>);

    const userToolsEvents: UserToolsFileEvents = {
      on: (cb) => {
        const refs = [
          this.app.vault.on('create', (f) => cb(f.path, 'create')),
          this.app.vault.on('modify', (f) => cb(f.path, 'modify')),
          this.app.vault.on('delete', (f) => cb(f.path, 'delete')),
          this.app.vault.on('rename', (f, oldPath) => {
            cb(f.path, 'rename');
            if (oldPath.length > 0) cb(oldPath, 'rename');
          }),
        ];
        refs.forEach((r) => this.registerEvent(r));
        return () => {
          for (const r of refs) this.app.vault.offref(r);
        };
      },
    };
    try {
      this.userTools = await wireUserTools({
        vault: vaultAdapter,
        toolRegistry: this.toolRegistry,
        logger: this.logger,
        notice: { notify: (msg) => new Notice(msg) },
        fileEvents: userToolsEvents,
        commands: {
          register: (id, name, run) => {
            registerLeoCommand(this, {
              id,
              name,
              callback: () => {
                void (async (): Promise<void> => {
                  await run();
                })();
              },
            });
          },
        },
      });
    } catch (err) {
      this.logger.warn('tool.user.wire.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.attachments = wireAttachments();

    this.contextStatusLine = wireContextStatusLine({
      createStatusEl: () => {
        const el = this.addStatusBarItem();
        return {
          setText: (text) => el.setText(text),
          detach: () => el.detach(),
        };
      },
      build: () => null,
    });

    this.uiHelpers = wireUiHelpers({
      notice: { show: (msg) => new Notice(msg) },
      statusBar: {
        create: () => {
          const el = this.addStatusBarItem();
          return {
            setText: (text) => {
              el.setText(text);
            },
            clear: () => {
              el.setText('');
            },
            remove: () => {
              el.detach();
            },
          };
        },
      },
      inlineDialog: {
        mount: () => () => undefined,
        isNativeModal: () => false,
      },
      inlineConfirmation: {
        present: () => () => undefined,
        isNativeModal: () => false,
      },
    });

    const replaceHistoryAfterCompact = (thread: string, result: CompactionResult): void => {
      const history: AgentHistoryMessage[] = result.summaryMessages.map((m) => ({
        role: 'user',
        content: m.content,
      }));
      agentHistory.set(thread, history);
    };
    const persistCompactSnapshot = (controller: CompactWidgetController): void => {
      try {
        const snapshot = controller.toTerminalSnapshot();
        const id = `compact-${snapshot.runId}`;
        const existing = this.chatMessageStore.getSnapshot().find((m) => m.id === id);
        if (existing !== undefined) {
          this.chatMessageStore.update(id, (prev) => ({
            ...prev,
            widget: { kind: COMPACT_TERMINAL_KIND, props: snapshot },
          }));
        } else {
          this.chatMessageStore.append({
            id,
            role: 'widget',
            content: '',
            createdAt: new Date().toISOString(),
            widget: { kind: COMPACT_TERMINAL_KIND, props: snapshot },
          });
        }
        releaseCompactLiveController(snapshot.runId);
      } catch (err) {
        this.logger.warn('compact.persist.append-failed', {
          runId: controller.viewModel().runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
    const beginCompactRun = (input: {
      runId: string;
      threadId: string;
      trigger: 'manual' | 'auto';
      customInstructions?: string;
    }): { controller: CompactWidgetController; phaseSink: CompactPhaseSink } => {
      const controller = new CompactWidgetController({
        runId: input.runId,
        threadId: input.threadId,
        trigger: input.trigger,
        ...(input.customInstructions !== undefined
          ? { customInstructions: input.customInstructions }
          : {}),
      });
      registerCompactLiveController(input.runId, controller);
      try {
        this.chatMessageStore.append({
          id: `compact-${input.runId}`,
          role: 'widget',
          content: '',
          createdAt: new Date().toISOString(),
          widget: {
            kind: COMPACT_LIVE_KIND,
            props: { runId: input.runId, threadId: input.threadId, trigger: input.trigger },
          },
        });
      } catch (err) {
        this.logger.warn('compact.live.append-failed', {
          runId: input.runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      let persisted = false;
      controller.subscribe((vm) => {
        if (persisted) return;
        if (!isTerminalCompactPhase(vm.phase)) return;
        persisted = true;
        persistCompactSnapshot(controller);
      });
      return { controller, phaseSink: makePhaseSinkFromController(controller) };
    };
    const compactRunner = {
      run: async (customInstructions?: string): Promise<void> => {
        const activeThread = this.getActiveThreadId();
        this.logger.info('compact.runner.run_called', {
          thread: activeThread,
          customInstructionsLength: customInstructions?.length ?? 0,
          historyLength: agentHistory.get(activeThread)?.length ?? 0,
        });
        const history = agentHistory.get(activeThread) ?? [];
        const messages: ChatMessage[] = history.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const runId = generateCompactRunId();
        const { controller, phaseSink } = beginCompactRun({
          runId,
          threadId: activeThread,
          trigger: 'manual',
          ...(customInstructions !== undefined ? { customInstructions } : {}),
        });
        if (messages.length === 0) {
          controller.recordError('empty_history', 'No conversation to compact');
          return;
        }
        const settings = this.store.get();
        const result = await runManualCompaction(messages, {
          logger: this.logger,
          provider: this.providerManager,
          model: settings.provider.chatModel,
          querySource: 'manual_compact',
          tracking: this.autocompactTracking,
          ...(settings.contextWindowOverride !== undefined
            ? { userOverride: settings.contextWindowOverride }
            : {}),
          ...(customInstructions !== undefined ? { customInstructions } : {}),
          invokedSkills: this.invokedSkills.toAutocompactList(MAIN_AGENT_ID),
          phaseSink,
        });
        if (result === null) {
          // phaseSink.error() / cancelled() already invoked inside runManualCompaction
          // for circuit-broken / no-stream / no-summary / aborted; widget reflects state.
          return;
        }
        replaceHistoryAfterCompact(activeThread, result);
      },
    };

    const readFileState = new ReadFileStateStore();
    let cachedExcludePatterns: readonly string[] | null = null;
    let cachedExcludeFn: (p: string) => boolean = (): boolean => false;
    const excludeMatcher = (path: string): boolean => {
      const patterns = this.store.get().indexing.excludePatterns ?? [];
      if (cachedExcludePatterns !== patterns) {
        cachedExcludePatterns = patterns;
        cachedExcludeFn = compileMatcher(normalizePatterns(patterns));
      }
      return cachedExcludeFn(path);
    };

    const toolSearchSession = new ToolSearchSession({
      settings: () => this.store.get().toolSearch,
      providerKind: () => this.store.get().provider.kind,
      modelId: () => this.store.get().provider.chatModel,
      registry: () => this.toolRegistry,
    });
    this.toolRegistry.register(
      createToolSearchTool(() =>
        toolSearchSession.snapshotFor(this.getActiveThreadId()),
      ) as unknown as ToolSpec<unknown, unknown>,
    );

    this.agentRunner = new AgentRunner({
      provider: this.providerManager,
      focusedContext: this.focusedContext,
      logger: this.logger,
      model: () => this.store.get().provider.chatModel,
      historyByThread: agentHistory,
      readState: readFileState,
      excludeMatcher,
      autocompact: {
        enabled: true,
        provider: this.providerManager,
        tracking: this.autocompactTracking,
        userOverride: () => this.store.get().contextWindowOverride,
        invokedSkills: () => this.invokedSkills.toAutocompactList(MAIN_AGENT_ID),
        replaceHistory: (thread, r) => replaceHistoryAfterCompact(thread, r),
        beginRun: ({ threadId }) => {
          const runId = generateCompactRunId();
          const { phaseSink } = beginCompactRun({
            runId,
            threadId,
            trigger: 'auto',
          });
          return phaseSink;
        },
      },
      toolRegistry: this.toolRegistry,
      vault: vaultAdapter,
      editor: editBridge,
      navigator: this.workspaceNavigator,
      canvasNavigator: this.canvasNavigator,
      planMode: this.planModeController,
      ragEngine: this.indexerRag.ragEngine,
      ragMode: () => this.store.get().ragMode,
      skillListing: {
        buildFor: ({ agentId }) => {
          const listing = buildSkillListingAttachment({
            registry: this.skillRegistry,
            agentId: agentId ?? MAIN_AGENT_ID,
          });
          if (listing === null) return null;
          return { content: listing.content, skillCount: listing.skillCount };
        },
      },
      allowedToolsForThread: () =>
        new Set(this.conversationStore.getThread().metadata.allowedTools),
      markThreadAllowed: (_thread, toolId) => {
        this.conversationStore.mutate((prev) => {
          if (prev.metadata.allowedTools.includes(toolId)) return prev;
          return {
            ...prev,
            metadata: {
              ...prev.metadata,
              allowedTools: [...prev.metadata.allowedTools, toolId],
            },
          };
        });
      },
      tracer: this.tracer,
      toolSearch: toolSearchSession,
      maxToolRoundTrips: () => this.store.get().provider.maxToolRoundTrips,
      disableParallelToolCalls: () => this.store.get().provider.disableParallelToolCalls,
    });

    const confirmationController = this.confirmationController;
    const streamStarter: ChatStreamStarter = (prompt, signal, blocks, options) => {
      const thread = this.getActiveThreadId();
      const onAbort = (): void => this.agentRunner.cancel(thread);
      signal.addEventListener('abort', onAbort, { once: true });
      const initialAllowedTools = options?.initialAllowedTools;
      const message: AgentUserMessage = {
        role: 'user',
        content: prompt,
        ...(blocks !== undefined && blocks.length > 0 ? { blocks } : {}),
        ...(initialAllowedTools !== undefined && initialAllowedTools.length > 0
          ? { initialAllowedTools }
          : {}),
      };
      const source = this.agentRunner.send(message, thread);
      return (async function* () {
        try {
          for await (const ev of source) {
            if (ev.type === 'tool_confirmation') {
              void (async () => {
                const decision = await confirmationController.request({
                  toolId: ev.request.toolId,
                  thread: ev.request.thread,
                  argsJson: ev.request.argsJson,
                  argsPretty: prettifyArgs(ev.request.argsJson),
                  category: ev.request.category,
                });
                ev.resolve(decision);
              })();
              continue;
            }
            yield ev;
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      })();
    };

    this.registerView(
      VIEW_TYPE_LEO_CHAT,
      (leaf) =>
        new ChatView(leaf, {
          logger: this.logger,
          focusedContext: this.focusedContext,
          workspaceNavigator: this.workspaceNavigator,
          streamStarter,
          messageStore: this.chatMessageStore,
          settingsStore: this.store,
          ...(this.threadsStore !== null
            ? { threadsSource: this.buildThreadsSource(this.threadsStore) }
            : {}),
          confirmationController: this.confirmationController,
          acceptRejectController: this.acceptRejectController,
          skillSlash: {
            list: () =>
              this.skillRegistry.availableSkills().map((skill) => ({
                name: skill.name,
                description: skill.description,
                ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
              })),
            run: async (name, args) => {
              const processed = await slashProcessor.process({
                skillName: name,
                args,
                agentId: MAIN_AGENT_ID,
                trigger: 'user',
                invocationContext: { threadId: this.getActiveThreadId() },
              });
              if (!processed.ok) {
                new Notice(`Skill failed: ${processed.error}`);
                return null;
              }
              const content = processed.messages.map((m) => m.content).join('\n\n');
              const modifier = processed.contextModifier;
              return {
                content,
                ...(modifier?.allowedTools !== undefined && modifier.allowedTools.length > 0
                  ? { initialAllowedTools: modifier.allowedTools }
                  : {}),
              };
            },
          },
          planMode: {
            enter: () => {
              void (async (): Promise<void> => {
                const threadId = this.getActiveThreadId();
                if (this.planModeController.getMode(threadId) === 'plan') {
                  this.planModeController.exitPlan(threadId);
                  return;
                }
                const slug = await this.planStore.currentSlug(threadId);
                this.planModeController.enterPlan(threadId, this.planStore.planPath(slug));
              })();
            },
            exit: () => this.planModeController.exitPlan(this.getActiveThreadId()),
          },
          planModeSource: {
            getMode: () => this.planModeController.getMode(this.getActiveThreadId()),
            subscribe: (cb) => {
              const off1 = this.planModeController.subscribe(cb);
              const off2 =
                this.threadsStore !== null
                  ? this.threadsStore.subscribe(() => cb())
                  : (): void => undefined;
              return (): void => {
                off1();
                off2();
              };
            },
          },
          analyzeContext: async (signal) => {
            const snap = this.contextSnapshot;
            if (snap === null) return this.analyzeContextForChat(signal);
            const fresh = await snap.refreshNow(signal);
            return fresh ?? snap.getSnapshot() ?? this.analyzeContextForChat(signal);
          },
          ...(this.contextSnapshot !== null ? { contextSnapshot: this.contextSnapshot } : {}),
          ...(this.ragCollector !== null
            ? { collectRagSnapshot: (signal: AbortSignal) => this.ragCollector!.collect(signal) }
            : {}),
          collectWikiStatus: async (_signal: AbortSignal) =>
            collectWikiStatus({
              vault: vaultAdapter,
              getMutexState: () => this.wikiMutex?.active() ?? WIKI_MUTEX_IDLE,
            }),
          collectCanvasStatus: async (_signal: AbortSignal) =>
            collectCanvasStatus({
              vault: vaultAdapter,
              mutex: this.canvasMutex,
            }),
          compactRunner,
          getContextWindow: () => {
            const s = this.store.get();
            return resolveContextWindow({
              model: s.provider.chatModel,
              ...(s.contextWindowOverride !== undefined
                ? { userOverride: s.contextWindowOverride }
                : {}),
            });
          },
          indexStatusSource: this.indexStatus ?? this.buildIndexStatusSource(),
          indexDrainSubscribe: (l) => this.indexerRag.vaultIndexer.subscribe(l),
          onReindexAll: () => {
            void (async (): Promise<void> => {
              const count = await this.indexerRag.reindexService.reindexVault();
              if (count !== null) new Notice(`Leo: re-indexed ${count} files.`);
            })();
          },
          onReindexChanged: () => {
            void (async (): Promise<void> => {
              const count = await this.indexerRag.vaultIndexer.drainPending();
              if (count > 0) new Notice(`Leo: re-indexed ${count} changed file(s).`);
            })();
          },
          planApprovalController: this.planApprovalController,
          clarifyingQuestionController: this.clarifyingQuestionController,
          ...(this.attachments !== null
            ? {
                attachments: this.attachments,
                pickFiles: () => pickFilesViaInput((n, b) => this.persistAttachmentBytes(n, b)),
                vaultFiles: () =>
                  this.app.vault.getFiles().map((f) => ({
                    path: f.path,
                    name: f.name,
                    kind: classifyVaultFile(f.extension),
                  })),
                readVaultFile: (path) => this.readVaultFileBytes(path),
                persistAttachment: (n, b) => this.persistAttachmentBytes(n, b),
              }
            : {}),
          piiDetector: createPiiDetectAgent({
            provider: this.providerManager,
            model: () => this.store.get().provider.chatModel,
            temperature: () => this.store.get().provider.temperature,
            logger: this.logger,
          }),
          clearThreadReadState: (threadId) => readFileState.clearThread(threadId),
          ...(this.mcp !== null ? { mcpClient: this.mcp.client } : {}),
          vault: vaultAdapter,
          editorBridge: editBridge,
          subscribeThemeChange: (cb) => {
            const ref = this.app.workspace.on('css-change', cb);
            return () => this.app.workspace.offref(ref);
          },
        }),
    );
    this.addRibbonIcon('bot', 'Leo: Open chat', () => {
      void openOrFocusChatView(this.app.workspace, { toggle: true });
    });
    this.app.workspace.onLayoutReady(() => {
      void this.maybeOpenChatOnFirstLaunch();
    });

    registerLeoCommand(this, {
      id: COMMAND_IDS.openSettings,
      name: 'Leo: Open settings',
      callback: () => openLeoSettings(this),
    });
    registerLeoCommand(this, {
      id: COMMAND_IDS.configureLmStudio,
      name: 'Leo: Configure LM Studio',
      callback: () => settingsTab.openWizard(this.store.get()),
    });
    registerLeoCommand(this, {
      id: COMMAND_IDS.openChat,
      name: 'Leo: Open chat',
      callback: () => {
        void openOrFocusChatView(this.app.workspace);
      },
    });

    registerLeoCommand(this, {
      id: 'leo-new-thread',
      name: 'Leo: New thread',
      callback: () => {
        void (async (): Promise<void> => {
          if (this.threadsStore === null) return;
          const id = await this.threadsStore.create();
          await this.threadsStore.switch(id);
          new Notice('Leo: new thread created.');
        })();
      },
    });

    registerLeoCommand(this, {
      id: 'leo-reindex-vault',
      name: 'Leo: Re-index vault',
      callback: () => {
        void (async (): Promise<void> => {
          const count = await this.indexerRag.reindexService.reindexVault();
          if (count !== null) new Notice(`Leo: re-indexed ${count} files.`);
        })();
      },
    });

    registerLeoCommand(this, {
      id: RAG_PALETTE_COMMAND_ID,
      name: RAG_PALETTE_COMMAND_NAME,
      callback: () => {
        void (async (): Promise<void> => {
          await openOrFocusChatView(this.app.workspace);
          const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_LEO_CHAT);
          const view = leaves[0]?.view;
          if (view instanceof ChatView) view.triggerRagSlash();
        })();
      },
    });

    this.logger.info('plugin.load', {
      version: this.manifest.version,
      graphRuntime: USE_GRAPH_RUNTIME,
    });
  }

  override onunload(): void {
    void this.shutdown();
  }

  private async shutdown(): Promise<void> {
    this.logger?.info('plugin.unload', {});
    // Reload-flush: write a final snapshot per non-terminal in-flight subgraph
    // so the widget rehydrates as ERROR{code:'reload'} on next thread open.
    try {
      const live = this.externalAgentOrchestrator?.liveHandlesSnapshot() ?? [];
      for (const handle of live) {
        const state = handle.state();
        const stateForSnapshot = {
          ...state,
          phase: 'error' as const,
          error: { code: 'reload', message: 'Plugin reloaded during run' },
          endedAt: state.endedAt ?? Date.now(),
          startedAt: state.startedAt ?? Date.now(),
        };
        const snapshot = buildTerminalSnapshot({
          state: stateForSnapshot,
          registry: this.adapterRegistry,
          resolvedConfig: {},
        });
        try {
          this.chatMessageStore?.append({
            id: `ea-${snapshot.runId}`,
            role: 'widget',
            content: '',
            createdAt: new Date().toISOString(),
            widget: { kind: EXTERNAL_AGENT_WIDGET_KIND, props: snapshot },
          });
        } catch {
          /* persistence failure on reload-flush is non-fatal */
        }
        handle.cancel();
      }
    } catch {
      /* */
    }
    try {
      const liveTasks = this.taskOrchestrator?.liveHandlesSnapshot() ?? [];
      for (const handle of liveTasks) {
        const controller = handle.controller;
        const vm = controller.viewModel();
        const reloadVm = {
          ...vm,
          phase: 'error' as const,
          error: { code: 'reload' as const, message: 'Plugin reloaded during run' },
          startedAt: vm.startedAt ?? Date.now(),
          endedAt: vm.endedAt ?? Date.now(),
        };
        const snapshot = buildTaskTerminalSnapshot({ view: reloadVm });
        try {
          this.chatMessageStore?.append({
            id: `task-${snapshot.runId}`,
            role: 'widget',
            content: '',
            createdAt: new Date().toISOString(),
            widget: { kind: SUBAGENT_TERMINAL_KIND, props: snapshot },
          });
        } catch {
          /* persistence failure on reload-flush is non-fatal */
        }
        handle.cancel();
      }
    } catch {
      /* */
    }
    this.threadsSubUnsub?.();
    this.threadsSubUnsub = null;
    this.chatStoreUnsub?.();
    this.chatStoreUnsub = null;
    this.contextSnapshotUnsub?.();
    this.contextSnapshotUnsub = null;
    this.contextSnapshotKeepalive?.();
    this.contextSnapshotKeepalive = null;
    this.contextSnapshot = null;
    this.vectorStoreCorruptionUnsub?.();
    this.vectorStoreCorruptionUnsub = null;
    this.indexerStatusTap?.dispose();
    this.indexerStatusTap = null;
    this.ragCollector = null;
    try {
      await this.threadsStore?.shutdown();
    } catch {
      /* logged by store */
    }
    this.confirmationController?.dispose();
    this.acceptRejectController?.dispose();
    this.agentRunner?.dispose();
    try {
      await this.tracer?.dispose();
    } catch {
      /* logged inside tracer */
    }
    this.planModeController?.dispose();
    this.todoStore?.dispose();
    this.editorBridge?.dispose();
    this.connectionUnsub?.();
    this.connectionUnsub = null;
    this.providerManager?.dispose();
    try {
      await this.indexerRag?.dispose();
    } catch {
      /* logged by wiring */
    }
    this.userTools?.dispose();
    this.userTools = null;
    this.attachments?.dispose();
    this.attachments = null;
    this.uiHelpers?.dispose();
    this.uiHelpers = null;
    this.contextStatusLine?.dispose();
    this.contextStatusLine = null;
    this.editLock?.release();
    this.planApprovalController?.dispose();
    try {
      this.mcpStartupController?.abort();
      this.mcpStartupController = null;
      if (this.mcp !== null) await this.mcp.shutdown();
    } catch {
      /* logged by wiring */
    }
    await this.sink?.flush();
  }

  private buildThreadsSource(store: ThreadsStore): ThreadsSource {
    return {
      subscribe: (cb) => store.subscribe(cb),
      getSnapshot: () => store.getSnapshot(),
      create: async () => {
        const id = await store.create();
        return id;
      },
      switch: (id) => store.switch(id),
      rename: (id, title) => store.rename(id, title),
      delete: (id) => store.delete(id),
    };
  }

  private async readVaultFileBytes(path: string): Promise<CaptureFileInput | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file === null) return null;
    const adapter = this.app.vault.adapter;
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : '';
    const mimeType = mimeFromExtension(ext);
    const buf = await adapter.readBinary(path);
    const bytes = new Uint8Array(buf);
    const name = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
    return { name, mimeType, bytes, size: bytes.byteLength, path };
  }

  private async runAttachmentRetention(adapter: VaultAdapter): Promise<void> {
    try {
      const ttl = this.store.get().attachments.retentionDays;
      const result = await purgeOldAttachments(adapter, ATTACHMENTS_DIR, ttl);
      if (result.removed > 0 || result.errors > 0) {
        this.logger?.info('attachments.retention.swept', {
          retentionDays: ttl,
          removed: result.removed,
          kept: result.kept,
          errors: result.errors,
        });
      }
    } catch (err) {
      this.logger?.warn('attachments.retention.failure', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async persistAttachmentBytes(name: string, bytes: Uint8Array): Promise<string | null> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(ATTACHMENTS_DIR))) {
        await adapter.mkdir(ATTACHMENTS_DIR);
      }
      const safeName = sanitizeAttachmentName(name);
      const filename = `${attachmentDateStamp()}-${attachmentRandomId()}-${safeName}`;
      const path = `${ATTACHMENTS_DIR}/${filename}`;
      const view = bytes;
      const buf = view.buffer.slice(
        view.byteOffset,
        view.byteOffset + view.byteLength,
      ) as ArrayBuffer;
      await adapter.writeBinary(path, buf);
      return path;
    } catch (err) {
      this.logger?.warn('attachments.persist.failure', {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async analyzeContextForChat(signal: AbortSignal): Promise<ContextData> {
    const thread = this.getActiveThreadId();
    const model = this.store.get().provider.chatModel;
    const history = this.chatMessageStore.getSnapshot();
    const { messages, originalMessages } = recordsToAnalyzerInputs(history);

    const allTools = this.toolRegistry.listFor(thread);
    const builtInDescriptors: ToolDescriptor[] = [];
    const mcpDescriptors: ToolDescriptor[] = [];
    for (const spec of allTools) {
      const desc: ToolDescriptor = {
        name: spec.id,
        description: spec.description,
        schemaJson: JSON.stringify(spec.parameters ?? {}),
      };
      if (spec.source === 'mcp') mcpDescriptors.push(desc);
      else builtInDescriptors.push(desc);
    }
    const builtInTotal = countToolDescriptorTokens(builtInDescriptors).total;
    const mcpTotal = countToolDescriptorTokens(mcpDescriptors).total;

    const skills = this.skillsStore.listAll();
    const skillTotal = countSkillFrontmatterTokens(
      skills.map((s) => ({
        name: s.name,
        description: s.description,
        ...(s.whenToUse !== undefined ? { whenToUse: s.whenToUse } : {}),
      })),
    ).total;

    // System prompt: LEO_PREAMBLE + PLAN_MODE_RULE are the always-on segments
    // we can count statically here. Per-turn injections (active note, RAG hits,
    // skill listing) vary per request and end up counted via `usage.input_tokens`.
    const systemTotal = roughTokenCountEstimation(`${LEO_PREAMBLE}\n\n${PLAN_MODE_RULE}`);

    const counters: ContextCounters = {
      countSystemTokens: async () => systemTotal,
      // No Leo analogue for memory files (CLAUDE.md), custom agents, or
      // standalone slash commands — slash is bound to skills. Per SRS §6.
      countMemoryFileTokens: async () => 0,
      countBuiltInToolTokens: async () => builtInTotal,
      countMcpToolTokens: async () => mcpTotal,
      countCustomAgentTokens: async () => 0,
      countSlashCommandTokens: async () => 0,
      approximateMessageTokens: async (ctx) => {
        const msgs = ctx.messages as unknown as readonly TokenMessage[];
        const breakdown = breakdownMessages(msgs);
        return { total: breakdown.totalTokens, breakdown };
      },
      countSkillTokens: async () => skillTotal,
    };

    return analyzeContextUsage({
      messages: messages as unknown as readonly ChatMessage[],
      originalMessages: originalMessages as unknown as readonly ChatMessage[],
      model,
      logger: this.logger,
      counters,
      ...(signal !== undefined ? { signal } : {}),
    });
  }

  private buildIndexStatusSource(): {
    hasIndex: () => boolean;
    subscribe: (cb: () => void) => () => void;
  } {
    const listeners = new Set<() => void>();
    let cachedHasIndex = false;
    const probe = async (): Promise<void> => {
      try {
        const rows = await this.indexerRag.vectorStore.getAll();
        const next = rows.length > 0;
        if (next !== cachedHasIndex) {
          cachedHasIndex = next;
          for (const l of listeners) l();
        }
      } catch {
        /* ignore */
      }
    };
    void probe();
    const unsub = this.indexerRag.vaultIndexer.subscribe((ev) => {
      if (ev.kind === 'complete') void probe();
    });
    this.register(() => unsub());
    return {
      hasIndex: () => cachedHasIndex,
      subscribe: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    };
  }

  private async maybeOpenChatOnFirstLaunch(): Promise<void> {
    if (this.store.get().ui.firstChatViewOpened) return;
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_LEO_CHAT).length > 0) {
      await this.store.update((prev) => ({
        ...prev,
        ui: { ...prev.ui, firstChatViewOpened: true },
      }));
      return;
    }
    await openOrFocusChatView(this.app.workspace);
    await this.store.update((prev) => ({
      ...prev,
      ui: { ...prev.ui, firstChatViewOpened: true },
    }));
  }
}

function extractContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c !== null && typeof c === 'object' && 'text' in c) return (c as { text: string }).text;
      return '';
    })
    .join('');
}

function resolveBannerKind(kind: string): BannerKind {
  if (kind === 'error' || kind === 'info' || kind === 'compact') return kind;
  return 'cancelled';
}

function storedToRecords(messages: readonly StoredMessage[]): ChatMessageRecord[] {
  const out: ChatMessageRecord[] = [];
  for (const m of messages) {
    if (m.role === 'tool') continue;
    const role: ChatMessageRecord['role'] =
      m.role === 'banner' || m.role === 'widget' || m.role === 'assistant' ? m.role : 'user';
    const status = isAssistantStatus(m.status) ? m.status : undefined;
    const record: ChatMessageRecord = {
      id: m.id,
      role,
      content: m.content,
      createdAt: m.createdAt,
      ...(status !== undefined ? { status } : {}),
      ...(m.tokens !== undefined
        ? {
            tokens: {
              input: m.tokens.input,
              output: m.tokens.output,
              total: m.tokens.total,
            },
          }
        : {}),
      ...(m.banner !== undefined
        ? {
            banner: {
              kind: resolveBannerKind(m.banner.kind),
              ...(m.banner.toolCount !== undefined ? { toolCount: m.banner.toolCount } : {}),
              ...(m.banner.message !== undefined ? { message: m.banner.message } : {}),
            },
          }
        : {}),
      ...(m.widget !== undefined ? { widget: { kind: m.widget.kind, props: m.widget.props } } : {}),
    };
    out.push(record);
  }
  return out;
}

function recordsToStored(records: readonly ChatMessageRecord[]): StoredMessage[] {
  return records.map((r) => {
    const base: StoredMessage = {
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.createdAt,
      ...(r.status !== undefined ? { status: r.status } : {}),
      ...(r.tokens !== undefined
        ? {
            tokens: {
              input: r.tokens.input,
              output: r.tokens.output,
              total: r.tokens.total,
            },
          }
        : {}),
      ...(r.banner !== undefined
        ? {
            banner: {
              kind: r.banner.kind,
              ...(r.banner.toolCount !== undefined ? { toolCount: r.banner.toolCount } : {}),
              ...(r.banner.message !== undefined ? { message: r.banner.message } : {}),
            },
          }
        : {}),
      ...(r.widget !== undefined ? { widget: { kind: r.widget.kind, props: r.widget.props } } : {}),
    };
    return base;
  });
}

function deriveAgentHistory(messages: readonly StoredMessage[]): AgentHistoryMessage[] {
  const out: AgentHistoryMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant' && m.status !== 'streaming') {
      out.push({ role: 'assistant', content: m.content });
    }
  }
  return out;
}

function isAssistantStatus(v: unknown): v is 'streaming' | 'done' | 'cancelled' | 'error' {
  return v === 'streaming' || v === 'done' || v === 'cancelled' || v === 'error';
}

const SECRETS_PATH = '.leo/secrets.json';

function buildSecretsPersistence(vault: VaultAdapter): SecretsPersistence {
  return {
    async load() {
      if (!(await vault.exists(SECRETS_PATH))) return null;
      try {
        const raw = await vault.read(SECRETS_PATH);
        const parsed = JSON.parse(raw) as unknown;
        if (parsed === null || typeof parsed !== 'object') return null;
        return parsed as Record<string, StoredSecret>;
      } catch {
        return null;
      }
    },
    async save(data) {
      await vault.mkdir('.leo');
      await vault.write(SECRETS_PATH, JSON.stringify(data, null, 2));
    },
  };
}

function resolveElectronSafeStorage(): SafeStorageLike | null {
  try {
    const w = globalThis as { require?: (id: string) => unknown };
    if (typeof w.require !== 'function') return null;
    const mod = w.require('electron') as { safeStorage?: SafeStorageLike } | null;
    if (mod?.safeStorage === undefined) return null;
    return mod.safeStorage;
  } catch {
    return null;
  }
}

const INLINE_KNOWN_PROVIDER_KINDS: readonly string[] = [
  'lmstudio',
  'openai',
  'anthropic',
  'ollama',
  'custom',
];

const INLINE_TOOL_DEFS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType;
}> = [
  {
    name: 'fetch_url',
    description:
      'Fetch a web URL via HTTP/HTTPS. Returns body text or parsed JSON, with redirect safety + size cap.',
    schema: fetchUrlInputSchema,
  },
  {
    name: 'search_web',
    description: 'Search the web (Tavily). Returns ranked results with titles, URLs, and snippets.',
    schema: searchWebInputSchema,
  },
  {
    name: 'read_file',
    description: 'Read a file from the per-run sandbox. Path is relative to sandbox root.',
    schema: readFileInputSchema,
  },
  {
    name: 'write_file',
    description:
      'Write a file to the per-run sandbox (utf-8 or base64). Overwrites existing content.',
    schema: writeFileInputSchema,
  },
  {
    name: 'append_file',
    description:
      'Append content to a file in the per-run sandbox (utf-8 or base64). Creates the file if missing. Caller adds any trailing newline.',
    schema: appendFileInputSchema,
  },
  {
    name: 'list_dir',
    description: 'List entries in the per-run sandbox.',
    schema: listDirInputSchema,
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the per-run sandbox.',
    schema: deleteFileInputSchema,
  },
  {
    name: 'grep',
    description:
      'Search for a pattern in sandbox files. Substring by default; set regex=true for JS regex. Returns {path,line,text} matches up to maxMatches (default 200). Skips binary files.',
    schema: grepInputSchema,
  },
  {
    name: 'glob',
    description:
      'List sandbox files matching a glob pattern (e.g. "**/*.md", "canon/**"). Returns relative paths up to maxResults (default 500).',
    schema: globInputSchema,
  },
  {
    name: 'download_to_file',
    description:
      'Fetch a URL and save the body directly to a sandbox path WITHOUT streaming bytes through the model. Strongly preferred over fetch_url+write_file when you only want to save bytes verbatim. Returns {relPath,bytesWritten,status,url}. Same SSRF/DNS/size guards as fetch_url.',
    schema: downloadToFileInputSchema,
  },
  {
    name: 'publish_artifact',
    description: 'Nominate a sandbox file as a final output artifact (with optional summary).',
    schema: publishArtifactInputSchema,
  },
  {
    name: 'extract_note',
    description:
      'Save a research note (title, summary, source URL, relevance) for later synthesis. Multistep route only.',
    schema: extractNoteInputSchema,
  },
  {
    name: 'todo_write',
    description:
      'Track structured progress on multi-item tasks. Pass the COMPLETE todos list each call (replaces prior). Use when the task has 3+ steps; max one in_progress at a time.',
    schema: todoWriteInputSchema,
  },
];

const INLINE_TOOL_DEF_BY_NAME = new Map(INLINE_TOOL_DEFS.map((def) => [def.name, def]));

interface BuildInlineChatModelInput {
  readonly providerId: string;
  readonly model: string;
  readonly endpoint: string;
  readonly apiKey: string;
  readonly temperature?: number;
}

function buildInlineChatModel(input: BuildInlineChatModelInput): BaseChatModel {
  const { providerId, model, endpoint, apiKey, temperature } = input;
  if (providerId === 'anthropic') {
    return new ChatAnthropic({
      model,
      apiKey,
      ...(temperature !== undefined ? { temperature } : {}),
      streaming: false,
      streamUsage: true,
      clientOptions: {
        dangerouslyAllowBrowser: true,
        ...(endpoint.length > 0 ? { baseURL: endpoint } : {}),
      },
    }) as unknown as BaseChatModel;
  }
  // OpenAI-compatible: openai, lmstudio, ollama, custom
  const baseURL = `${endpoint.replace(/\/+$/, '')}/v1`; // NOSONAR(typescript:S5852): anchored trailing-slash trim, linear.
  return new ChatOpenAI({
    model,
    apiKey: apiKey.length > 0 ? apiKey : 'placeholder',
    ...(temperature !== undefined ? { temperature } : {}),
    streaming: false,
    streamUsage: true,
    configuration: {
      baseURL,
      dangerouslyAllowBrowser: true,
    },
  }) as unknown as BaseChatModel;
}

function resolveInlineEndpoint(providerId: string, store: SettingsStore): string {
  const settings = store.get();
  if (settings.provider.kind === providerId && settings.provider.endpoint.length > 0) {
    return settings.provider.endpoint;
  }
  return defaultEndpointFor(
    providerId as 'lmstudio' | 'openai' | 'anthropic' | 'ollama' | 'ollama-cloud' | 'custom',
  );
}

function resolveInlineSearchWebKey(config: InlineAgentConfig, tavilyCached: string): string {
  const ref = config.tools.searchWeb.apiKeyRef;
  if (ref.startsWith(SAFE_STORAGE_PREFIX)) return tavilyCached;
  return ref;
}

function bindInlineChatModelAdapter(
  model: BaseChatModel,
  traceConfig?: InlineAgentInvokeTraceConfig,
): InlineAgentManualChatModelAdapter {
  return {
    async invokeTurn({ messages, toolNames, signal }): Promise<InlineAgentAssistantStep> {
      const lcMessages = inlineRewriteToLangchain(messages);
      const tools = toolNames
        .map((name) => INLINE_TOOL_DEF_BY_NAME.get(name))
        .filter((def): def is (typeof INLINE_TOOL_DEFS)[number] => def !== undefined);
      const callable =
        tools.length > 0
          ? (
              model as unknown as {
                bindTools: (defs: unknown[], opts?: Record<string, unknown>) => BaseChatModel;
              }
            ).bindTools(
              tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema })),
              { parallel_tool_calls: false },
            )
          : model;
      const invokeOpts: Record<string, unknown> = { signal };
      if (traceConfig?.callbacks !== undefined) invokeOpts.callbacks = traceConfig.callbacks;
      if (traceConfig?.metadata !== undefined) invokeOpts.metadata = traceConfig.metadata;
      if (traceConfig?.tags !== undefined) invokeOpts.tags = traceConfig.tags;
      const result = (await callable.invoke(lcMessages, invokeOpts)) as AIMessage;
      const text = extractContentText(result.content);
      const rawCalls =
        (
          result as unknown as {
            tool_calls?: ReadonlyArray<{ id?: string; name?: string; args?: unknown }>;
          }
        ).tool_calls ?? [];
      const toolCalls = rawCalls
        .filter((tc) => typeof tc.name === 'string' && tc.name.length > 0)
        .map((tc) => ({
          id: tc.id ?? '',
          name: tc.name as string,
          args: tc.args ?? {},
        }));
      const usageMeta = (result as unknown as { usage_metadata?: { total_tokens?: number } })
        .usage_metadata;
      const usage = typeof usageMeta?.total_tokens === 'number' ? usageMeta.total_tokens : 0;
      return { text, toolCalls, usage };
    },
  };
}

function inlineRewriteToLangchain(messages: readonly InlineAgentRewriteMessage[]): BaseMessage[] {
  // Tool messages reference toolCallIds, but the in-memory assistant message
  // does not carry tool_calls (see runManualLoop in branches/simpleBranch.ts).
  // Re-emitting tool results as user-prefix text avoids OpenAI/Anthropic's
  // strict tool_call_id pairing requirement while preserving model context.
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push(new SystemMessage(m.content));
    } else if (m.role === 'human' || m.role === 'user') {
      out.push(new HumanMessage(m.content));
    } else if (m.role === 'assistant' || m.role === 'ai') {
      if (m.content.length > 0) out.push(new AIMessage(m.content));
    } else if (m.role === 'tool') {
      const toolName = m.name ?? 'tool';
      out.push(new HumanMessage(`Result from ${toolName}: ${m.content}`));
    }
  }
  return out;
}
