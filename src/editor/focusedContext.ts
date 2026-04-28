import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { FocusedContext, FocusedPos, FocusedSelection, FocusedViewport } from './types';

export interface FocusSnapshot {
  readonly cursor: FocusedPos;
  readonly selection: FocusedSelection | null;
}

function snapshotFromState(state: EditorState): FocusSnapshot {
  const sel = state.selection.main;
  const doc = state.doc;
  const head = doc.lineAt(sel.head);
  const cursor: FocusedPos = { line: head.number - 1, ch: sel.head - head.from };
  if (sel.empty) return { cursor, selection: null };
  const from = doc.lineAt(sel.from);
  const to = doc.lineAt(sel.to);
  return {
    cursor,
    selection: {
      from: { line: from.number - 1, ch: sel.from - from.from },
      to: { line: to.number - 1, ch: sel.to - to.from },
    },
  };
}

export const focusSnapshotField: StateField<FocusSnapshot> = StateField.define<FocusSnapshot>({
  create: (state) => snapshotFromState(state),
  update: (value, tr) =>
    tr.docChanged || tr.selection !== undefined ? snapshotFromState(tr.state) : value,
});

function viewportOf(view: EditorView): FocusedViewport {
  const { from, to } = view.viewport;
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number - 1;
  const endLine = doc.lineAt(to).number - 1;
  return { from: startLine, to: endLine, text: view.state.sliceDoc(from, to) };
}

export function readFocusedContextFromView(view: EditorView, file: string | null): FocusedContext {
  const snap = view.state.field(focusSnapshotField, false) ?? snapshotFromState(view.state);
  return {
    file,
    cursor: snap.cursor,
    selection: snap.selection,
    viewport: viewportOf(view),
  };
}

export interface FocusedContextExtensionHooks {
  onUpdate: (view: EditorView) => void;
}

export function createFocusedContextExtension(hooks: FocusedContextExtensionHooks): Extension {
  return [
    focusSnapshotField,
    EditorView.updateListener.of((vu) => {
      if (vu.docChanged || vu.selectionSet || vu.viewportChanged) {
        hooks.onUpdate(vu.view);
      }
    }),
  ];
}
