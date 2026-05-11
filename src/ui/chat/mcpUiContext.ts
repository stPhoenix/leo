import { createContext, useContext } from 'react';
import type { McpUiAction, McpUiActionResponse } from '@/mcp/mcpUiActions';
import type { ObsidianThemeSnapshot } from './hooks/useObsidianThemeVars';

export interface McpUiContextValue {
  readonly theme: ObsidianThemeSnapshot;
  readonly dispatchAction: (action: McpUiAction, serverId: string) => Promise<McpUiActionResponse>;
  readonly onError?: (err: Error) => void;
}

export const McpUiContext = createContext<McpUiContextValue | null>(null);

export function useMcpUiContext(): McpUiContextValue | null {
  return useContext(McpUiContext);
}
