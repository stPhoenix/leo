import type { ToolCtx, EditNoteBridge } from '@/tools/types';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WorkspaceNavigator } from '@/editor/workspaceNavigator';

export const noopEditor: EditNoteBridge = {
  isActiveNote: () => false,
  applyActiveEdit: async () => ({ ok: false, error: 'noop' }),
};

export function makeToolCtx(overrides: {
  readonly vault?: VaultAdapter;
  readonly editor?: EditNoteBridge;
  readonly navigator?: WorkspaceNavigator;
  readonly thread?: string;
  readonly signal?: AbortSignal;
}): ToolCtx {
  return {
    thread: overrides.thread ?? 't',
    signal: overrides.signal ?? new AbortController().signal,
    vault: overrides.vault ?? ({} as VaultAdapter),
    editor: overrides.editor ?? noopEditor,
    ...(overrides.navigator !== undefined ? { navigator: overrides.navigator } : {}),
  };
}
