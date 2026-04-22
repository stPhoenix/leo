import { describe, expect, it } from 'vitest';
import { iconFor, renderToolIcon } from '@/ui/toolIcons';

describe('tool icon registry', () => {
  it('resolves built-in read / write / search / edit tool ids to built-in Lucide icons', () => {
    expect(iconFor('read_note')).toEqual({ iconName: 'file-text', source: 'builtin' });
    expect(iconFor('search_vault')).toEqual({ iconName: 'search', source: 'builtin' });
    expect(iconFor('create_note').iconName).toBe('file-plus');
    expect(iconFor('append_to_note').iconName).toBe('file-plus-2');
    expect(iconFor('edit_note').iconName).toBe('pencil');
  });

  it('returns the generic MCP icon plus serverId for mcp.<serverId>.<tool>', () => {
    const info = iconFor('mcp.github.create_issue');
    expect(info.source).toBe('mcp');
    expect(info.iconName).toBe('plug');
    expect(info.serverId).toBe('github');
    expect(info.labelKey).toBe('mcp.server.github');
  });

  it('returns a fallback icon for unknown non-MCP tool ids', () => {
    expect(iconFor('zzz_unknown').iconName).toBe('circle-help');
    expect(iconFor('zzz_unknown').source).toBe('builtin');
  });

  it('renderToolIcon resolves an MCP server label via the consumer-supplied lookup', () => {
    const labels = (key: string): string | null => (key === 'mcp.server.github' ? 'GitHub' : null);
    const rendered = renderToolIcon({ toolId: 'mcp.github.create_issue', labels });
    expect(rendered.source).toBe('mcp');
    expect(rendered.iconName).toBe('plug');
    expect(rendered.serverLabel).toBe('GitHub');
    expect(rendered.serverId).toBe('github');
  });

  it('falls back to the serverId when the label lookup returns null', () => {
    const rendered = renderToolIcon({ toolId: 'mcp.github.x', labels: () => null });
    expect(rendered.serverLabel).toBe('github');
  });
});
