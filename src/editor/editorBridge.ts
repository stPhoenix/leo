import type { EditorView } from '@codemirror/view';
import type {
  Editor,
  EventRef,
  MarkdownFileInfo,
  MarkdownView,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import type { Logger } from '@/platform/Logger';
import { debounce, type DebouncedFn } from '@/util/debounce';
import { createFocusedContextExtension } from './focusedContext';
import type { FocusedContext, FocusedContextSink } from './types';

export interface EditorFocusProbe {
  read(): FocusedContext;
  observeView(view: EditorView): void;
  onLeafChange(leaf: WorkspaceLeaf | null): void;
  onFileOpen(file: TFile | null): void;
}

export type PluginLike = Pick<Plugin, 'app' | 'registerEvent' | 'registerEditorExtension'>;

export interface EditorBridgeOptions {
  plugin: PluginLike;
  sink: FocusedContextSink;
  logger: Logger;
  probe: EditorFocusProbe;
  debounceMs?: number;
  now?: () => number;
}

const DEFAULT_DEBOUNCE_MS = 300;

export class EditorBridge {
  private readonly plugin: PluginLike;
  private readonly sink: FocusedContextSink;
  private readonly logger: Logger;
  private readonly probe: EditorFocusProbe;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly debounced: DebouncedFn<[]>;
  private started = false;

  constructor(opts: EditorBridgeOptions) {
    this.plugin = opts.plugin;
    this.sink = opts.sink;
    this.logger = opts.logger;
    this.probe = opts.probe;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = opts.now ?? (() => performance.now());
    this.debounced = debounce(() => this.emit('debounced'), this.debounceMs);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const { plugin, probe } = this;
    plugin.registerEditorExtension(
      createFocusedContextExtension({
        onUpdate: (view) => {
          probe.observeView(view);
          this.notify();
        },
      }),
    );
    const ws = plugin.app.workspace;
    plugin.registerEvent(
      ws.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        probe.onLeafChange(leaf);
        this.debounced.cancel();
        this.emit('active-leaf-change');
      }),
    );
    plugin.registerEvent(
      ws.on('file-open', (file: TFile | null) => {
        probe.onFileOpen(file);
        this.debounced.cancel();
        this.emit('file-open');
      }),
    );
    plugin.registerEvent(
      ws.on('editor-change', (_editor: Editor, _info: MarkdownView | MarkdownFileInfo) => {
        this.notify();
      }),
    );
    this.emit('initial');
  }

  dispose(): void {
    this.debounced.cancel();
    this.started = false;
  }

  notify(): void {
    this.debounced();
  }

  flush(): void {
    this.debounced.flush();
  }

  private emit(source: string): void {
    const t0 = this.now();
    const ctx = this.probe.read();
    this.sink.push(ctx);
    const dt = this.now() - t0;
    this.logger.debug('editor.focus', {
      source,
      file: ctx.file,
      hasCursor: ctx.cursor !== null,
      hasSelection: ctx.selection !== null,
      viewportFrom: ctx.viewport?.from ?? null,
      viewportTo: ctx.viewport?.to ?? null,
      dispatchMs: Math.round(dt * 1000) / 1000,
    });
  }
}

export type { EventRef };
