import type { Workspace, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_LEO_CHAT } from './viewType';

export type OpenAction = 'opened' | 'revealed' | 'closed' | 'no-op';

export interface OpenChatOptions {
  readonly toggle?: boolean;
}

export async function openOrFocusChatView(
  workspace: Workspace,
  options: OpenChatOptions = {},
): Promise<OpenAction> {
  const existing = workspace.getLeavesOfType(VIEW_TYPE_LEO_CHAT);
  if (existing.length > 0) {
    const leaf = existing[0]!;
    if (options.toggle === true && workspace.activeLeaf === leaf) {
      leaf.detach();
      return 'closed';
    }
    workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
    return 'revealed';
  }
  const leaf: WorkspaceLeaf | null = workspace.getRightLeaf(false);
  if (leaf === null) return 'no-op';
  await leaf.setViewState({ type: VIEW_TYPE_LEO_CHAT, active: true });
  workspace.revealLeaf(leaf);
  return 'opened';
}
