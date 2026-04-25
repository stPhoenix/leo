import type { ToolCtx, EditNoteBridge } from '@/tools/types';
import type { VaultAdapter } from '@/storage/vaultAdapter';

export const noopEditor: EditNoteBridge = {
  isActiveNote: () => false,
  applyActiveEdit: async () => ({ ok: false, error: 'noop' }),
};

export function makeToolCtx(overrides: {
  readonly vault?: VaultAdapter;
  readonly editor?: EditNoteBridge;
  readonly thread?: string;
  readonly signal?: AbortSignal;
}): ToolCtx {
  return {
    thread: overrides.thread ?? 't',
    signal: overrides.signal ?? new AbortController().signal,
    vault: overrides.vault ?? ({} as VaultAdapter),
    editor: overrides.editor ?? noopEditor,
  };
}
