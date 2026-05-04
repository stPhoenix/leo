import type { ProviderKind, ToolSearchSettings } from '@/settings/settingsStore';

export function isToolSearchEnabled(settings: ToolSearchSettings): boolean {
  if (settings.killSwitch) return false;
  if (settings.mode === 'standard') return false;
  return true;
}

export function isNativeDeferralSupported(
  modelId: string,
  providerKind: ProviderKind,
  settings: ToolSearchSettings,
): boolean {
  if (providerKind !== 'anthropic') return false;
  const lower = modelId.toLowerCase();
  for (const sub of settings.unsupportedModelSubstrings) {
    if (lower.includes(sub.toLowerCase())) return false;
  }
  return true;
}
