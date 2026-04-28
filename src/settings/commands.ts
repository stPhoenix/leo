import type { Command, Plugin } from 'obsidian';

export interface LeoCommand extends Command {
  id: string;
  name: string;
}

export function registerLeoCommand(plugin: Plugin, command: LeoCommand): void {
  plugin.addCommand(command);
}

export const COMMAND_IDS = {
  openSettings: 'leo-open-settings',
  configureLmStudio: 'leo-configure-lm-studio',
  openChat: 'leo-open-chat',
} as const;

export function openLeoSettings(plugin: Plugin): void {
  const setting = (
    plugin.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }
  ).setting;
  if (setting === undefined) return;
  setting.open?.();
  setting.openTabById?.(plugin.manifest.id);
}
