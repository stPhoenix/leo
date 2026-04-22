export interface ToolIconInfo {
  readonly iconName: string;
  readonly source: 'builtin' | 'mcp';
  readonly serverId?: string;
  readonly labelKey?: string;
}

const BUILTIN: Record<string, string> = {
  read_note: 'file-text',
  search_vault: 'search',
  create_note: 'file-plus',
  append_to_note: 'file-plus-2',
  edit_note: 'pencil',
};

const MCP_ICON = 'plug';

export function iconFor(toolId: string): ToolIconInfo {
  if (toolId.startsWith('mcp.')) {
    const parts = toolId.split('.');
    const serverId = parts[1] ?? '';
    return {
      iconName: MCP_ICON,
      source: 'mcp',
      serverId,
      labelKey: `mcp.server.${serverId}`,
    };
  }
  const name = BUILTIN[toolId];
  if (name !== undefined) {
    return { iconName: name, source: 'builtin' };
  }
  return { iconName: 'circle-help', source: 'builtin' };
}

export interface ToolLabelLookup {
  (key: string): string | null;
}

export interface ToolIconRenderInput {
  readonly toolId: string;
  readonly labels?: ToolLabelLookup;
}

export interface ToolIconRender {
  readonly iconName: string;
  readonly source: 'builtin' | 'mcp';
  readonly serverLabel?: string;
  readonly serverId?: string;
}

export function renderToolIcon(input: ToolIconRenderInput): ToolIconRender {
  const info = iconFor(input.toolId);
  if (info.source === 'mcp') {
    const label =
      input.labels !== undefined && info.labelKey !== undefined
        ? (input.labels(info.labelKey) ?? info.serverId ?? '')
        : (info.serverId ?? '');
    return {
      iconName: info.iconName,
      source: 'mcp',
      ...(info.serverId !== undefined ? { serverId: info.serverId } : {}),
      serverLabel: label,
    };
  }
  return { iconName: info.iconName, source: 'builtin' };
}
