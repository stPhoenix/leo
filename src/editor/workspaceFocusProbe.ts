import type { EditorView } from '@codemirror/view';
import { MarkdownView, type App, type Editor, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { EditorFocusProbe } from './editorBridge';
import { readFocusedContextFromView } from './focusedContext';
import { NULL_FOCUSED_CONTEXT, type FocusedContext } from './types';

export class WorkspaceFocusProbe implements EditorFocusProbe {
  private last: { view: EditorView; file: TFile | null } | null = null;

  constructor(private readonly app: App) {}

  observeView(view: EditorView): void {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.last = { view, file: active?.file ?? null };
  }

  onLeafChange(leaf: WorkspaceLeaf | null): void {
    const view = leaf?.view;
    if (view instanceof MarkdownView) {
      const cm = extractView(view.editor);
      this.last = cm !== null ? { view: cm, file: view.file ?? null } : null;
    }
  }

  onFileOpen(file: TFile | null): void {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active === null) {
      this.last = null;
      return;
    }
    const cm = extractView(active.editor);
    this.last = cm !== null ? { view: cm, file: file ?? active.file ?? null } : null;
  }

  read(): FocusedContext {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active !== null) {
      const cm = extractView(active.editor);
      if (cm !== null) return readFocusedContextFromView(cm, active.file?.path ?? null);
    }
    if (this.last !== null) {
      return readFocusedContextFromView(this.last.view, this.last.file?.path ?? null);
    }
    return NULL_FOCUSED_CONTEXT;
  }
}

function extractView(editor: Editor): EditorView | null {
  const maybe = editor as unknown as { cm?: EditorView };
  return maybe.cm ?? null;
}
