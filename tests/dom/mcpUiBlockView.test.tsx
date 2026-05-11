// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import { MCPUIBlockView } from '@/ui/chat/blocks/MCPUIBlockView';
import type { McpUiContent } from '@/chat/types';
import type { ObsidianThemeSnapshot } from '@/ui/chat/hooks/useObsidianThemeVars';
import type { McpUiAction, McpUiActionResponse } from '@/mcp/mcpUiActions';

afterEach(cleanup);

function makeResource(over: Partial<McpUiContent> = {}): McpUiContent {
  return {
    type: 'mcp_ui',
    uri: 'ui://srv/widget',
    mimeType: 'text/html',
    html: '<button id="b">Accept</button>',
    ...over,
  };
}

function makeTheme(): ObsidianThemeSnapshot {
  return {
    css: ':root{--text-normal:#fff;--background-primary:#111;}',
    map: { '--text-normal': '#fff', '--background-primary': '#111' },
  };
}

describe('MCPUIBlockView', () => {
  let onAction: (action: McpUiAction) => Promise<McpUiActionResponse>;
  let onActionCalls: { action: McpUiAction }[];

  beforeEach(() => {
    onActionCalls = [];
    onAction = vi.fn(async (action: McpUiAction): Promise<McpUiActionResponse> => {
      onActionCalls.push({ action });
      return { ok: true };
    });
  });

  it('renders iframe with allow-scripts sandbox only', () => {
    const { container } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-top-navigation');
  });

  it('injects CSP meta and theme css into srcdoc', () => {
    const { container } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    const iframe = container.querySelector('iframe');
    const srcdoc = iframe?.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('--text-normal:#fff');
    expect(srcdoc).toContain('--background-primary:#111');
    expect(srcdoc).toContain('<button id="b">Accept</button>');
  });

  it('exposes uri + mimeType via data attributes', () => {
    const { container } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    const root = container.querySelector('[data-slot="mcp-ui"]');
    expect(root?.getAttribute('data-mcp-ui-uri')).toBe('ui://srv/widget');
    expect(root?.getAttribute('data-mcp-ui-mime')).toBe('text/html');
  });

  it('routes a valid postMessage action to onAction', async () => {
    const { container } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    // happy-dom sets contentWindow eventually; trigger by dispatching a MessageEvent
    // whose source matches iframe.contentWindow.
    await act(async () => {
      const event = new MessageEvent('message', {
        source: iframe.contentWindow as Window,
        data: { type: 'tool', payload: { toolName: 'doIt', params: { x: 1 } } },
      });
      window.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onActionCalls).toHaveLength(1);
    expect(onActionCalls[0]?.action).toEqual({
      type: 'tool',
      payload: { toolName: 'doIt', params: { x: 1 } },
    });
  });

  it('ignores messages from unknown sources', async () => {
    render(<MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />);
    await act(async () => {
      const event = new MessageEvent('message', {
        source: window,
        data: { type: 'tool', payload: { toolName: 'evil' } },
      });
      window.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onActionCalls).toHaveLength(0);
  });

  it('ignores malformed messages', async () => {
    const { container } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    await act(async () => {
      const event = new MessageEvent('message', {
        source: iframe.contentWindow as Window,
        data: { type: 'unknown', payload: {} },
      });
      window.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onActionCalls).toHaveLength(0);
  });

  it('updates iframe height on ui-size-change message', async () => {
    const { container } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    await act(async () => {
      const event = new MessageEvent('message', {
        source: iframe.contentWindow as Window,
        data: { type: 'ui-size-change', payload: { height: 200 } },
      });
      window.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(iframe.style.height).toBe('200px');
  });

  it('caps height at maxHeight', async () => {
    const { container } = render(
      <MCPUIBlockView
        resource={makeResource()}
        theme={makeTheme()}
        onAction={onAction}
        maxHeight={150}
      />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    await act(async () => {
      const event = new MessageEvent('message', {
        source: iframe.contentWindow as Window,
        data: { type: 'ui-size-change', payload: { height: 5000 } },
      });
      window.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(iframe.style.height).toBe('150px');
  });

  it('cleans up message listener on unmount', () => {
    const initialListenerCount = (window as unknown as { _listeners?: number })._listeners ?? 0;
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <MCPUIBlockView resource={makeResource()} theme={makeTheme()} onAction={onAction} />,
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    removeSpy.mockRestore();
    void initialListenerCount;
  });
});
