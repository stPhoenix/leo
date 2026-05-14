import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { McpUiContent } from '@/chat/types';
import type { ObsidianThemeSnapshot } from '../hooks/useObsidianThemeVars';
import { parseMcpUiAction, type McpUiAction, type McpUiActionResponse } from '@/mcp/mcpUiActions';

export interface MCPUIBlockViewProps {
  readonly resource: McpUiContent;
  readonly theme: ObsidianThemeSnapshot;
  readonly onAction: (action: McpUiAction) => Promise<McpUiActionResponse>;
  readonly onError?: (err: Error) => void;
  readonly maxHeight?: number;
}

const DEFAULT_MAX_HEIGHT = 720;
const MIN_HEIGHT = 80;
const SANDBOX_FLAGS = 'allow-scripts';

const CSP_META =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none';";

const HOST_MESSAGE_KIND = 'leo-mcp-ui-host';

function buildSrcDoc(html: string, themeCss: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP_META}">
<style>${themeCss}</style>
<style>
html,body{margin:0;padding:0;font-family:var(--font-interface);color:var(--text-normal);background:var(--background-primary);}
body{padding:8px;}
button{font-family:inherit;color:inherit;}
</style>
<script>
(function(){
  function applyVars(vars){
    if(!vars||typeof vars!=='object')return;
    for(var k in vars){try{document.documentElement.style.setProperty(k,vars[k]);}catch(e){}}
  }
  window.addEventListener('message',function(e){
    if(e.source!==window.parent)return;
    var d=e.data;
    if(!d||d.kind!==${JSON.stringify(HOST_MESSAGE_KIND)})return;
    if(d.type==='theme-update')applyVars(d.vars);
  });
  function postSize(){
    var h=Math.ceil(document.documentElement.scrollHeight);
    try{window.parent.postMessage({type:'ui-size-change',payload:{height:h}},'*');}catch(e){}
  }
  if(typeof ResizeObserver==='function'){
    try{new ResizeObserver(postSize).observe(document.documentElement);}catch(e){}
  }
  window.addEventListener('load',postSize);
})();
</script>
</head>
<body>${html}</body>
</html>`;
}

function MCPUIBlockViewImpl(props: MCPUIBlockViewProps): JSX.Element {
  const { resource, theme, onAction, onError } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(MIN_HEIGHT);
  const maxHeight = props.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const srcDoc = useMemo(() => buildSrcDoc(resource.html, theme.css), [resource.html, theme.css]);

  const respond = useCallback(
    (messageId: string | undefined, payload: McpUiActionResponse): void => {
      if (messageId === undefined) return;
      const win = iframeRef.current?.contentWindow;
      if (win === null || win === undefined) return;
      try {
        // NOSONAR(typescript:S2819): sandboxed srcDoc iframe has origin "null"; literal is the only valid target.
        win.postMessage({ kind: HOST_MESSAGE_KIND, type: 'response', messageId, payload }, 'null');
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    [onError],
  );

  useEffect(() => {
    const handler = (event: MessageEvent<unknown>): void => {
      const win = iframeRef.current?.contentWindow;
      if (win === null || win === undefined) return;
      if (event.source !== win) return;
      const data = event.data;
      if (data === null || typeof data !== 'object') return;
      const obj = data as Record<string, unknown>;
      if (obj.type === 'ui-size-change') {
        const payload = obj.payload as { height?: unknown } | undefined;
        const h = typeof payload?.height === 'number' ? payload.height : null;
        if (h !== null && Number.isFinite(h)) {
          setHeight(Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.ceil(h))));
        }
        return;
      }
      const action = parseMcpUiAction(data);
      if (action === null) return;
      onAction(action)
        .then((response) => respond(action.messageId, response))
        .catch((err) => {
          onError?.(err instanceof Error ? err : new Error(String(err)));
          respond(action.messageId, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }, [onAction, onError, respond, maxHeight]);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (win === null || win === undefined) return;
    try {
      // NOSONAR(typescript:S2819): sandboxed srcDoc iframe has origin "null"; literal is the only valid target.
      win.postMessage({ kind: HOST_MESSAGE_KIND, type: 'theme-update', vars: theme.map }, 'null');
    } catch (err) {
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }, [theme.map, onError]);

  return (
    <div
      className="leo-mcp-ui"
      data-slot="mcp-ui"
      data-mcp-ui-uri={resource.uri}
      data-mcp-ui-mime={resource.mimeType}
    >
      <iframe
        ref={iframeRef}
        className="leo-mcp-ui-frame"
        title={`MCP UI ${resource.uri}`}
        sandbox={SANDBOX_FLAGS}
        srcDoc={srcDoc}
        style={{ width: '100%', height: `${height}px`, border: '0' }}
      />
    </div>
  );
}

export const MCPUIBlockView = memo(MCPUIBlockViewImpl);
