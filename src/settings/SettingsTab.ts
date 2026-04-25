import { Notice, PluginSettingTab, Setting, setIcon, type App, type Plugin } from 'obsidian';
import {
  PROVIDER_KINDS,
  SECTION_LABELS,
  SECTION_ORDER,
  SECTION_PLACEHOLDERS,
  type LeoSettings,
  type ProviderKind,
  type SectionId,
  type SettingsStore,
} from './settingsStore';
import type { SafeStorage } from '@/storage/safeStorage';
import { kindRequiresApiKey, defaultEndpointFor } from '@/providers/registry';
import type { LogLevel } from '@/platform/logTypes';
import { LOG_LEVELS } from '@/platform/logTypes';
import type { Logger } from '@/platform/Logger';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import type { ProviderManager } from '@/providers/providerManager';
import type { ProviderModel } from '@/providers/types';
import { WizardModal, makeWizardProbe } from './wizardModal';
import type { SkillsStore } from '@/skills/skillsStore';
import type {
  SkillDraft,
  SkillEditorController,
  SkillValidationError,
} from '@/skills/skillEditorController';
import type { McpSettingsStore } from '@/mcp/settingsStore';
import type { MCPClient, ServerStatus } from '@/mcp/mcpClient';
import type { McpServerConfig, McpTransportKind } from '@/mcp/config';

export interface SettingsTabDeps {
  readonly store: SettingsStore;
  readonly providerManager: ProviderManager;
  readonly logger: Logger;
  readonly safeStorage?: SafeStorage;
  readonly skillsStore?: SkillsStore;
  readonly skillEditor?: SkillEditorController;
  readonly mcpSettingsStore?: McpSettingsStore;
  readonly mcpClient?: MCPClient;
}

interface McpDraft {
  readonly mode: 'create' | 'edit';
  readonly originalId: string | null;
  id: string;
  enabled: boolean;
  transport: McpTransportKind;
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
}

const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  lmstudio: 'LM Studio (local)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama (local)',
  custom: 'Custom (OpenAI-compatible)',
};

export class SettingsTab extends PluginSettingTab {
  private discoveredModels: ProviderModel[] = [];
  private renderDisposers: Array<() => void> = [];
  private editingSkillId: string | null = null;
  private skillDraft: SkillDraft | null = null;
  private skillSaveErrors: readonly SkillValidationError[] = [];
  private mcpDraft: McpDraft | null = null;
  private mcpSaveError: string | null = null;
  private mcpServersCache: readonly McpServerConfig[] = [];

  constructor(
    app: App,
    private readonly plugin: Plugin,
    private readonly deps: SettingsTabDeps,
  ) {
    super(app, plugin);
  }

  override display(): void {
    this.flushRenderDisposers();
    this.containerEl.empty();
    this.containerEl.addClass('leo-settings-tab');

    const settings = this.deps.store.get();
    for (const id of SECTION_ORDER) {
      this.renderSection(id, settings);
    }
  }

  override hide(): void {
    this.flushRenderDisposers();
    super.hide();
  }

  private flushRenderDisposers(): void {
    for (const d of this.renderDisposers) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
    this.renderDisposers = [];
  }

  private renderSection(id: SectionId, settings: LeoSettings): void {
    const expanded = settings.ui.expandedSections[id] === true;
    const section = this.containerEl.createDiv({ cls: 'leo-section' });
    const header = section.createDiv({ cls: 'leo-section-header' });
    header.setAttr('role', 'button');
    header.setAttr('tabindex', '0');
    header.setAttr('aria-expanded', String(expanded));
    header.setAttr('aria-controls', `leo-section-body-${id}`);

    const chevron = header.createSpan({ cls: 'leo-section-chevron' });
    setIcon(chevron, expanded ? 'chevron-down' : 'chevron-right');
    header.createSpan({ cls: 'leo-section-title', text: SECTION_LABELS[id] });

    const body = section.createDiv({ cls: 'leo-section-body' });
    body.id = `leo-section-body-${id}`;
    body.style.display = expanded ? '' : 'none';

    const toggle = (): void => {
      void this.deps.store.update((prev) => ({
        ...prev,
        ui: {
          ...prev.ui,
          expandedSections: {
            ...prev.ui.expandedSections,
            [id]: !(prev.ui.expandedSections[id] === true),
          },
        },
      }));
      this.display();
    };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        toggle();
      }
    });

    if (expanded) this.renderSectionBody(id, body, settings);
  }

  private renderSectionBody(id: SectionId, body: HTMLElement, settings: LeoSettings): void {
    if (id === 'provider') {
      this.renderProviderBody(body, settings);
      return;
    }
    if (id === 'indexing') {
      this.renderIndexingBody(body, settings);
      return;
    }
    if (
      id === 'skills' &&
      this.deps.skillsStore !== undefined &&
      this.deps.skillEditor !== undefined
    ) {
      this.renderSkillsBody(body, this.deps.skillsStore, this.deps.skillEditor);
      return;
    }
    if (id === 'mcp' && this.deps.mcpSettingsStore !== undefined) {
      this.renderMcpBody(body, this.deps.mcpSettingsStore, this.deps.mcpClient);
      return;
    }
    if (id === 'advanced') {
      this.renderAdvancedBody(body, settings);
      return;
    }
    const placeholder = SECTION_PLACEHOLDERS[id];
    if (placeholder !== undefined) {
      body.createEl('p', { text: placeholder, cls: 'leo-section-placeholder' });
    }
  }

  private renderIndexingBody(body: HTMLElement, settings: LeoSettings): void {
    new Setting(body)
      .setName('Exclude patterns')
      .setDesc(
        'Glob patterns (one per line) for files excluded from indexing and RAG results. Example: templates/**, journal/private/**.',
      )
      .addTextArea((t) => {
        t.inputEl.rows = 5;
        t.inputEl.style.width = '100%';
        t.setValue(settings.indexing.excludePatterns.join('\n'));
        t.onChange(async (raw) => {
          const patterns = raw
            .split('\n')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          await this.deps.store.update((prev) => ({
            ...prev,
            indexing: { ...prev.indexing, excludePatterns: patterns },
          }));
        });
      });

    body.createEl('p', {
      cls: 'leo-section-help',
      text: 'Run "Leo: Re-index vault" from the command palette to re-build the index after changes.',
    });
  }

  private renderProviderBody(body: HTMLElement, settings: LeoSettings): void {
    if (!settings.ui.firstRunComplete) {
      this.renderWelcomePanel(body, settings);
      return;
    }
    this.renderProviderFields(body, settings);
  }

  private renderWelcomePanel(body: HTMLElement, settings: LeoSettings): void {
    const panel = body.createDiv({ cls: 'leo-welcome-panel' });
    panel.createEl('h3', { text: 'Welcome to Leo' });
    panel.createEl('p', {
      text:
        'Leo needs a local model endpoint to run. Start LM Studio, load a chat model, ' +
        'then finish setup below.',
    });
    const btn = panel.createEl('button', { cls: 'mod-cta', text: 'Configure LM Studio' });
    btn.setAttr('aria-label', 'Configure LM Studio');
    btn.addEventListener('click', () => this.openWizard(settings));
  }

  openWizard(settings: LeoSettings): void {
    const modal = new WizardModal(this.app, {
      initialEndpoint: settings.provider.endpoint,
      initialChatModel: settings.provider.chatModel,
      initialEmbeddingModel: settings.provider.embeddingModel,
      probe: makeWizardProbe(),
      persist: async ({ endpoint, chatModel, embeddingModel }) => {
        await this.deps.store.update((prev) => ({
          ...prev,
          provider: { ...prev.provider, endpoint, chatModel, embeddingModel },
          ui: { ...prev.ui, firstRunComplete: true },
        }));
        new Notice('Leo configured.');
        this.display();
      },
    });
    modal.open();
  }

  private renderProviderFields(body: HTMLElement, settings: LeoSettings): void {
    new Setting(body)
      .setName('Provider')
      .setDesc('Choose which provider backs chat and embeddings.')
      .addDropdown((d) => {
        for (const kind of PROVIDER_KINDS) d.addOption(kind, PROVIDER_KIND_LABELS[kind]);
        d.setValue(settings.provider.kind);
        d.onChange(async (value) => {
          const next = value as ProviderKind;
          const currentEndpoint = this.deps.store.get().provider.endpoint;
          const shouldResetEndpoint =
            currentEndpoint.length === 0 ||
            currentEndpoint === defaultEndpointFor(this.deps.store.get().provider.kind);
          await this.deps.store.update((prev) => ({
            ...prev,
            provider: {
              ...prev.provider,
              kind: next,
              endpoint: shouldResetEndpoint ? defaultEndpointFor(next) : prev.provider.endpoint,
            },
          }));
          this.display();
        });
      });

    new Setting(body)
      .setName('Endpoint URL')
      .setDesc('Provider base URL.')
      .addText((t) => {
        t.setValue(settings.provider.endpoint).onChange(async (value) => {
          await this.deps.store.update((prev) => ({
            ...prev,
            provider: { ...prev.provider, endpoint: value },
          }));
        });
      });

    if (kindRequiresApiKey(settings.provider.kind) && this.deps.safeStorage !== undefined) {
      const safeStorage = this.deps.safeStorage;
      const key = `provider.${settings.provider.kind}.apiKey`;
      void safeStorage.get(key).then((existing) => {
        new Setting(body)
          .setName('API key')
          .setDesc(
            safeStorage.keyringAvailable()
              ? 'Stored via Electron safeStorage (OS keyring).'
              : 'Stored with obfuscation only — OS keyring not available.',
          )
          .addText((t) => {
            t.inputEl.type = 'password';
            t.setValue(existing ?? '').onChange(async (value) => {
              if (value.length === 0) {
                await safeStorage.delete(key);
              } else {
                await safeStorage.set(key, value);
              }
            });
          });
      });
    }

    this.renderModelPicker(body, settings, 'chat');
    this.renderModelPicker(body, settings, 'embedding');

    new Setting(body)
      .setName('Temperature')
      .setDesc('0 = deterministic, 2 = highly random.')
      .addSlider((s) => {
        s.setLimits(0, 2, 0.05)
          .setValue(settings.provider.temperature)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.deps.store.update((prev) => ({
              ...prev,
              provider: { ...prev.provider, temperature: value },
            }));
          });
      });

    new Setting(body)
      .setName('Max tokens')
      .setDesc('Upper bound for response length.')
      .addText((t) => {
        t.setValue(String(settings.provider.maxTokens)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 1) return;
          await this.deps.store.update((prev) => ({
            ...prev,
            provider: { ...prev.provider, maxTokens: parsed },
          }));
        });
      });

    new Setting(body)
      .setName('Context window override')
      .setDesc(
        'Manual context window size (tokens) for autocompact + status line. Empty = auto-detect. Beats model ID and provider-reported size.',
      )
      .addText((t) => {
        t.setPlaceholder('auto')
          .setValue(
            settings.contextWindowOverride !== undefined
              ? String(settings.contextWindowOverride)
              : '',
          )
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (trimmed === '') {
              await this.deps.store.update((prev) => {
                const { contextWindowOverride: _drop, ...rest } = prev;
                return rest as LeoSettings;
              });
              return;
            }
            const parsed = Number.parseInt(trimmed, 10);
            if (!Number.isFinite(parsed) || parsed < 1) return;
            await this.deps.store.update((prev) => ({
              ...prev,
              contextWindowOverride: parsed,
            }));
          });
      });

    const status = body.createDiv({ cls: 'leo-provider-status' });
    this.renderProviderStatus(status);

    new Setting(body)
      .setName('Re-probe endpoint')
      .setDesc('Reload the available model list and re-test the connection.')
      .addButton((b) => {
        b.setButtonText('Re-probe').onClick(async () => {
          await this.probeAndRender(status);
        });
      });
  }

  private renderModelPicker(
    body: HTMLElement,
    settings: LeoSettings,
    kind: 'chat' | 'embedding',
  ): void {
    const fieldName = kind === 'chat' ? 'Chat model' : 'Embedding model';
    const valueKey = kind === 'chat' ? 'chatModel' : 'embeddingModel';
    const reachable = this.deps.providerManager.connection.isReachable();
    const setting = new Setting(body).setName(fieldName);
    if (reachable && this.discoveredModels.length > 0) {
      setting.addDropdown((d) => {
        for (const m of this.discoveredModels) d.addOption(m.id, m.id);
        const current = settings.provider[valueKey];
        if (current.length > 0 && this.discoveredModels.some((m) => m.id === current)) {
          d.setValue(current);
        }
        d.onChange(async (value) => {
          await this.deps.store.update((prev) => ({
            ...prev,
            provider: { ...prev.provider, [valueKey]: value },
          }));
        });
      });
    } else {
      setting.setDesc('Provider unreachable — type a model id manually.').addText((t) => {
        t.setValue(settings.provider[valueKey]).onChange(async (value) => {
          await this.deps.store.update((prev) => ({
            ...prev,
            provider: { ...prev.provider, [valueKey]: value },
          }));
        });
      });
    }
  }

  private renderProviderStatus(host: HTMLElement): void {
    host.empty();
    const reachable = this.deps.providerManager.connection.isReachable();
    if (reachable) {
      host.setText(`Status: connected · ${this.discoveredModels.length} models`);
    } else {
      host.setText('Status: unreachable');
    }
  }

  private async probeAndRender(host: HTMLElement): Promise<void> {
    host.setText('Status: probing…');
    try {
      const provider = new LMStudioProvider({
        endpoint: () => this.deps.store.get().provider.endpoint,
      });
      this.discoveredModels = await provider.listModels();
      this.deps.providerManager.connection.markReachable();
      this.renderProviderStatus(host);
      this.display();
    } catch (err) {
      this.deps.providerManager.connection.markUnreachable();
      this.deps.logger.warn('settings.probe.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      host.setText('Status: unreachable');
    }
  }

  private renderAdvancedBody(body: HTMLElement, settings: LeoSettings): void {
    new Setting(body)
      .setName('Log level')
      .setDesc('Verbosity of the on-disk log under .leo/logs/leo.log.')
      .addDropdown((d) => {
        for (const level of LOG_LEVELS) d.addOption(level, level);
        d.setValue(settings.logLevel).onChange(async (value) => {
          const next = value as LogLevel;
          await this.deps.store.update((prev) => ({ ...prev, logLevel: next }));
          this.deps.logger.setLevel(next);
        });
      });
  }

  private renderSkillsBody(
    body: HTMLElement,
    skillsStore: SkillsStore,
    editor: SkillEditorController,
  ): void {
    if (this.editingSkillId !== null && this.skillDraft !== null) {
      this.renderSkillEditor(body, editor);
      return;
    }

    const skills = [...skillsStore.listAll()].sort((a, b) => a.name.localeCompare(b.name));
    const header = body.createDiv({ cls: 'leo-section-help' });
    header.setText(`${skills.length} skill${skills.length === 1 ? '' : 's'} loaded.`);

    new Setting(body)
      .setName('Add skill')
      .setDesc('Create a new user skill stored under .leo/skills/<name>/SKILL.md.')
      .addButton((b) => {
        b.setButtonText('New skill')
          .setCta()
          .onClick(() => {
            this.editingSkillId = '__new__';
            this.skillDraft = editor.openDraftForNew();
            this.skillSaveErrors = [];
            this.display();
          });
      });

    if (skills.length === 0) {
      body.createEl('p', { cls: 'leo-section-help', text: 'No skills loaded yet.' });
      return;
    }

    for (const skill of skills) {
      const setting = new Setting(body)
        .setName(skill.displayName)
        .setDesc(
          `${skill.source} · ${skill.name}${skill.description.length > 0 ? ` — ${skill.description}` : ''}`,
        );
      setting.addButton((b) => {
        b.setButtonText('Edit').onClick(() => {
          const draft = editor.openDraftForEdit(skill.name);
          if (draft === null) {
            new Notice(`Skill ${skill.name} not found`);
            return;
          }
          this.editingSkillId = skill.name;
          this.skillDraft = draft;
          this.skillSaveErrors = [];
          this.display();
        });
      });
      setting.addButton((b) => {
        b.setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            if (!confirm(`Delete skill "${skill.displayName}"?`)) return;
            const res = await editor.deleteUserSkill(skill.name);
            if (!res.ok) {
              new Notice(`Delete failed: ${res.error}`);
              return;
            }
            this.display();
          });
      });
    }
  }

  private renderSkillEditor(body: HTMLElement, editor: SkillEditorController): void {
    const draft = this.skillDraft;
    if (draft === null) return;
    const mode: 'create' | 'edit' = this.editingSkillId === '__new__' ? 'create' : 'edit';

    const heading = body.createEl('h4');
    heading.setText(mode === 'create' ? 'New skill' : `Edit skill: ${draft.name}`);

    const updateDraft = (patch: Partial<SkillDraft>): void => {
      this.skillDraft = { ...draft, ...patch } as SkillDraft;
    };

    new Setting(body)
      .setName('name')
      .setDesc('Canonical kebab-case name (a-z 0-9 hyphens). Becomes the directory name.')
      .addText((t) => {
        t.setValue(draft.name);
        t.inputEl.disabled = mode === 'edit';
        t.onChange((v) => updateDraft({ name: v.trim() }));
      });
    this.appendErrorsForField(body, 'name');
    this.appendErrorsForField(body, 'name-duplicate');

    new Setting(body).setName('display name').addText((t) => {
      t.setValue(draft.displayName).onChange((v) => updateDraft({ displayName: v }));
    });
    this.appendErrorsForField(body, 'displayName');

    new Setting(body)
      .setName('description')
      .setDesc('Short summary shown in the turn-0 listing.')
      .addTextArea((t) => {
        t.inputEl.rows = 2;
        t.inputEl.style.width = '100%';
        t.setValue(draft.description).onChange((v) => updateDraft({ description: v }));
      });
    this.appendErrorsForField(body, 'description');

    new Setting(body)
      .setName('when to use')
      .setDesc('Hint the model uses to decide when to invoke this skill.')
      .addTextArea((t) => {
        t.inputEl.rows = 2;
        t.inputEl.style.width = '100%';
        t.setValue(draft.whenToUse).onChange((v) => updateDraft({ whenToUse: v }));
      });

    new Setting(body)
      .setName('body')
      .setDesc('Skill body injected on invocation. Supports $1, $ARGUMENTS, ${CLAUDE_SKILL_DIR}.')
      .addTextArea((t) => {
        t.inputEl.rows = 10;
        t.inputEl.style.width = '100%';
        t.setValue(draft.body).onChange((v) => updateDraft({ body: v }));
      });
    this.appendErrorsForField(body, 'body');

    new Setting(body)
      .setName('allowed tools')
      .setDesc('Comma-separated tool ids scoped during the skill turn.')
      .addText((t) => {
        t.setValue([...draft.allowedTools].join(', ')).onChange((v) => {
          const tools = v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          updateDraft({ allowedTools: tools });
        });
      });

    new Setting(body)
      .setName('paths')
      .setDesc(
        'Optional gitignore-style patterns; skill stays hidden until a matching file is touched.',
      )
      .addText((t) => {
        t.setValue(draft.paths.join(', ')).onChange((v) => {
          const paths = v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          updateDraft({ paths });
        });
      });

    new Setting(body).setName('argument hint').addText((t) => {
      t.setValue(draft.argumentHint ?? '').onChange((v) => {
        const trimmed = v.trim();
        updateDraft({ argumentHint: trimmed.length > 0 ? trimmed : null });
      });
    });

    new Setting(body)
      .setName('argument names')
      .setDesc('Comma-separated names; map to $NAME substitutions.')
      .addText((t) => {
        t.setValue(draft.argNames.join(', ')).onChange((v) => {
          const names = v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          updateDraft({ argNames: names });
        });
      });

    new Setting(body)
      .setName('model override')
      .setDesc('Optional model id for this skill; blank = use the current model.')
      .addText((t) => {
        t.setValue(draft.model ?? '').onChange((v) => {
          const trimmed = v.trim();
          updateDraft({ model: trimmed.length > 0 ? trimmed : null });
        });
      });

    new Setting(body).setName('disable model invocation').addToggle((t) => {
      t.setValue(draft.disableModelInvocation).onChange((v) =>
        updateDraft({ disableModelInvocation: v }),
      );
    });

    new Setting(body).setName('user invocable').addToggle((t) => {
      t.setValue(draft.userInvocable).onChange((v) => updateDraft({ userInvocable: v }));
    });

    new Setting(body)
      .addButton((b) => {
        b.setButtonText('Save')
          .setCta()
          .onClick(async () => {
            if (this.skillDraft === null) return;
            const res = await editor.save(this.skillDraft, mode);
            if (!res.ok) {
              if ('errors' in res) {
                this.skillSaveErrors = res.errors;
              } else {
                this.skillSaveErrors = [{ field: 'name', message: res.error }];
              }
              this.display();
              return;
            }
            this.editingSkillId = null;
            this.skillDraft = null;
            this.skillSaveErrors = [];
            this.display();
          });
      })
      .addButton((b) => {
        b.setButtonText('Cancel').onClick(() => {
          this.editingSkillId = null;
          this.skillDraft = null;
          this.skillSaveErrors = [];
          this.display();
        });
      });
  }

  private appendErrorsForField(body: HTMLElement, field: SkillValidationError['field']): void {
    for (const err of this.skillSaveErrors) {
      if (err.field === field) {
        body.createEl('div', { cls: 'leo-section-error', text: err.message });
      }
    }
  }

  private renderMcpBody(
    body: HTMLElement,
    store: McpSettingsStore,
    client: MCPClient | undefined,
  ): void {
    if (this.mcpDraft !== null) {
      this.renderMcpEditor(body, store, client);
      return;
    }

    const header = body.createDiv({ cls: 'leo-section-help' });
    header.setText('MCP servers connect Leo to external tools and resources.');

    new Setting(body)
      .setName('Add MCP server')
      .setDesc('Configure a stdio command or SSE endpoint.')
      .addButton((b) => {
        b.setButtonText('Add server')
          .setCta()
          .onClick(() => {
            this.mcpDraft = createEmptyMcpDraft();
            this.mcpSaveError = null;
            this.display();
          });
      });

    const listHost = body.createDiv();
    listHost.createEl('p', { cls: 'leo-section-help', text: 'Loading servers…' });

    void store.list().then((servers) => {
      this.mcpServersCache = servers;
      listHost.empty();
      this.renderMcpServerList(listHost, servers, store, client);
      if (client !== undefined) {
        const unsub = client.onStatusChange(({ serverId, status }) => {
          const cell = listHost.querySelector<HTMLElement>(
            `[data-mcp-status-id="${cssEscape(serverId)}"]`,
          );
          if (cell !== null) cell.setText(status);
        });
        this.renderDisposers.push(unsub);
      }
    });
  }

  private renderMcpServerList(
    listHost: HTMLElement,
    servers: readonly McpServerConfig[],
    store: McpSettingsStore,
    client: MCPClient | undefined,
  ): void {
    if (servers.length === 0) {
      listHost.createEl('p', { cls: 'leo-section-help', text: 'No servers configured yet.' });
      return;
    }
    for (const server of servers) {
      const status: ServerStatus | '—' = client?.getServer(server.id)?.status ?? '—';
      const setting = new Setting(listHost).setName(server.id);
      const desc = setting.descEl;
      desc.empty();
      desc.appendText(`${server.transport} · status: `);
      const statusEl = desc.createSpan({ text: String(status) });
      statusEl.setAttr('data-mcp-status-id', server.id);

      setting.addToggle((t) => {
        t.setValue(server.enabled).onChange(async (enabled) => {
          const res = await store.toggle(server.id);
          if (!res.ok) {
            new Notice(`Toggle failed: ${res.error}`);
            t.setValue(server.enabled);
            return;
          }
          if (client !== undefined) {
            const updated: McpServerConfig = { ...server, enabled } as McpServerConfig;
            if (enabled) {
              await client.reload(updated);
            } else {
              await client.disconnect(server.id);
            }
          }
          this.display();
        });
      });

      setting.addButton((b) => {
        b.setButtonText('Edit').onClick(() => {
          this.mcpDraft = mcpConfigToDraft(server);
          this.mcpSaveError = null;
          this.display();
        });
      });
      setting.addButton((b) => {
        b.setButtonText('Delete')
          .setWarning()
          .onClick(async () => {
            if (!confirm(`Delete MCP server "${server.id}"?`)) return;
            const res = await store.remove(server.id);
            if (!res.ok) {
              new Notice(`Delete failed: ${res.error}`);
              return;
            }
            if (client !== undefined) await client.disconnect(server.id);
            this.display();
          });
      });
    }
  }

  private renderMcpEditor(
    body: HTMLElement,
    store: McpSettingsStore,
    client: MCPClient | undefined,
  ): void {
    const draft = this.mcpDraft;
    if (draft === null) return;
    const heading = body.createEl('h4');
    heading.setText(draft.mode === 'create' ? 'New MCP server' : `Edit ${draft.originalId}`);

    new Setting(body)
      .setName('id')
      .setDesc('Server id (URL-safe). Used to namespace tools as mcp.{id}.toolName.')
      .addText((t) => {
        t.setValue(draft.id);
        t.inputEl.disabled = draft.mode === 'edit';
        t.onChange((v) => {
          draft.id = v.trim();
        });
      });

    new Setting(body).setName('enabled').addToggle((t) => {
      t.setValue(draft.enabled).onChange((v) => {
        draft.enabled = v;
      });
    });

    new Setting(body).setName('transport').addDropdown((d) => {
      d.addOption('stdio', 'stdio');
      d.addOption('sse', 'sse');
      d.setValue(draft.transport);
      d.onChange((v) => {
        draft.transport = v as McpTransportKind;
        this.display();
      });
    });

    if (draft.transport === 'stdio') {
      new Setting(body)
        .setName('command')
        .setDesc('Executable to spawn (absolute path or PATH-resolvable).')
        .addText((t) => {
          t.setValue(draft.command).onChange((v) => {
            draft.command = v;
          });
        });
      new Setting(body)
        .setName('args')
        .setDesc('Command-line arguments, one per line.')
        .addTextArea((t) => {
          t.inputEl.rows = 3;
          t.inputEl.style.width = '100%';
          t.setValue(draft.argsText).onChange((v) => {
            draft.argsText = v;
          });
        });
      new Setting(body)
        .setName('env')
        .setDesc(
          'Environment variables, one per line as KEY=value. Prefix value with secret: to store via safeStorage.',
        )
        .addTextArea((t) => {
          t.inputEl.rows = 4;
          t.inputEl.style.width = '100%';
          t.setValue(draft.envText).onChange((v) => {
            draft.envText = v;
          });
        });
    } else {
      new Setting(body)
        .setName('url')
        .setDesc('SSE endpoint URL (must start with http:// or https://).')
        .addText((t) => {
          t.setValue(draft.url).onChange((v) => {
            draft.url = v.trim();
          });
        });
      new Setting(body)
        .setName('headers')
        .setDesc(
          'HTTP headers, one per line as Header: value. Prefix value with secret: to store via safeStorage.',
        )
        .addTextArea((t) => {
          t.inputEl.rows = 4;
          t.inputEl.style.width = '100%';
          t.setValue(draft.headersText).onChange((v) => {
            draft.headersText = v;
          });
        });
    }

    if (this.mcpSaveError !== null) {
      body.createEl('div', { cls: 'leo-section-error', text: this.mcpSaveError });
    }

    new Setting(body)
      .addButton((b) => {
        b.setButtonText('Save')
          .setCta()
          .onClick(async () => {
            if (this.mcpDraft === null) return;
            const built = await this.buildMcpConfig(this.mcpDraft);
            if (!built.ok) {
              this.mcpSaveError = built.error;
              this.display();
              return;
            }
            const res =
              this.mcpDraft.mode === 'create'
                ? await store.add(built.config)
                : await store.edit(this.mcpDraft.originalId ?? built.config.id, built.config);
            if (!res.ok) {
              this.mcpSaveError = res.error;
              this.display();
              return;
            }
            if (client !== undefined && built.config.enabled) {
              try {
                await client.reload(built.config);
              } catch (err) {
                this.deps.logger.warn('settings.mcp.reload-failed', {
                  serverId: built.config.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
            this.mcpDraft = null;
            this.mcpSaveError = null;
            this.display();
          });
      })
      .addButton((b) => {
        b.setButtonText('Cancel').onClick(() => {
          this.mcpDraft = null;
          this.mcpSaveError = null;
          this.display();
        });
      });
  }

  private async buildMcpConfig(
    draft: McpDraft,
  ): Promise<{ ok: true; config: McpServerConfig } | { ok: false; error: string }> {
    if (draft.id.length === 0) return { ok: false, error: 'id is required' };
    if (draft.transport === 'stdio') {
      if (draft.command.length === 0) return { ok: false, error: 'command is required' };
      const args = draft.argsText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const envParse = await this.parseSecretMap(draft.envText, draft.id, 'env', '=');
      if (!envParse.ok) return envParse;
      return {
        ok: true,
        config: {
          id: draft.id,
          enabled: draft.enabled,
          transport: 'stdio',
          command: draft.command,
          ...(args.length > 0 ? { args } : {}),
          ...(Object.keys(envParse.map).length > 0 ? { env: envParse.map } : {}),
        },
      };
    }
    if (!/^https?:\/\//.test(draft.url)) {
      return { ok: false, error: 'url must start with http:// or https://' };
    }
    const headersParse = await this.parseSecretMap(draft.headersText, draft.id, 'headers', ':');
    if (!headersParse.ok) return headersParse;
    return {
      ok: true,
      config: {
        id: draft.id,
        enabled: draft.enabled,
        transport: 'sse',
        url: draft.url,
        ...(Object.keys(headersParse.map).length > 0 ? { headers: headersParse.map } : {}),
      },
    };
  }

  private async parseSecretMap(
    raw: string,
    serverId: string,
    field: 'env' | 'headers',
    sep: string,
  ): Promise<{ ok: true; map: Record<string, string> } | { ok: false; error: string }> {
    const map: Record<string, string> = {};
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      const idx = line.indexOf(sep);
      if (idx <= 0) {
        return { ok: false, error: `${field} line missing "${sep}": ${line}` };
      }
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key.length === 0) {
        return { ok: false, error: `${field} key is empty in: ${line}` };
      }
      if (value.startsWith('secret:')) {
        const safeStorage = this.deps.safeStorage;
        if (safeStorage === undefined) {
          return { ok: false, error: 'safeStorage unavailable — cannot store secret values' };
        }
        const plain = value.slice('secret:'.length);
        const storageKey = `mcp.${serverId}.${field}.${key}`;
        await safeStorage.set(storageKey, plain);
        map[key] = `safestorage:${storageKey}`;
      } else {
        map[key] = value;
      }
    }
    return { ok: true, map };
  }
}

function createEmptyMcpDraft(): McpDraft {
  return {
    mode: 'create',
    originalId: null,
    id: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    argsText: '',
    envText: '',
    url: '',
    headersText: '',
  };
}

function mcpConfigToDraft(config: McpServerConfig): McpDraft {
  const base: McpDraft = {
    mode: 'edit',
    originalId: config.id,
    id: config.id,
    enabled: config.enabled,
    transport: config.transport,
    command: '',
    argsText: '',
    envText: '',
    url: '',
    headersText: '',
  };
  if (config.transport === 'stdio') {
    base.command = config.command;
    base.argsText = (config.args ?? []).join('\n');
    base.envText = formatStringMap(config.env, '=');
  } else {
    base.url = config.url;
    base.headersText = formatStringMap(config.headers, ': ');
  }
  return base;
}

function formatStringMap(map: Record<string, string> | undefined, sep: string): string {
  if (map === undefined) return '';
  return Object.entries(map)
    .map(([k, v]) => `${k}${sep}${v}`)
    .join('\n');
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, (m) => `\\${m}`);
}
