import { describe, expect, it } from 'vitest';
import {
  extractMcpUiResources,
  hasMcpUiResources,
  MCP_UI_HTML_MIME,
  MCP_UI_REMOTE_DOM_MIME,
} from '@/mcp/mcpUiTypes';

describe('extractMcpUiResources', () => {
  it('returns empty result for non-object data', () => {
    expect(extractMcpUiResources(null).uiResources).toHaveLength(0);
    expect(extractMcpUiResources('hi').uiResources).toHaveLength(0);
    expect(extractMcpUiResources(42).uiResources).toHaveLength(0);
  });

  it('returns empty when content is missing or not an array', () => {
    expect(extractMcpUiResources({}).uiResources).toHaveLength(0);
    expect(extractMcpUiResources({ content: 'foo' }).uiResources).toHaveLength(0);
  });

  it('collects text parts', () => {
    const r = extractMcpUiResources({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });
    expect(r.textParts).toEqual(['hello', 'world']);
    expect(r.uiResources).toHaveLength(0);
  });

  it('extracts ui:// resource with text/html mime', () => {
    const r = extractMcpUiResources({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'ui://server/widget',
            mimeType: MCP_UI_HTML_MIME,
            text: '<button>Accept</button>',
          },
        },
      ],
    });
    expect(r.uiResources).toHaveLength(1);
    expect(r.uiResources[0]).toEqual({
      uri: 'ui://server/widget',
      mimeType: MCP_UI_HTML_MIME,
      html: '<button>Accept</button>',
    });
  });

  it('extracts remote-dom mime even without ui:// prefix', () => {
    const r = extractMcpUiResources({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'urn:example:widget',
            mimeType: MCP_UI_REMOTE_DOM_MIME,
            text: 'script',
          },
        },
      ],
    });
    expect(r.uiResources).toHaveLength(1);
    expect(r.uiResources[0]?.mimeType).toBe(MCP_UI_REMOTE_DOM_MIME);
  });

  it('defaults missing mimeType to text/html when uri starts with ui://', () => {
    const r = extractMcpUiResources({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'ui://x/y',
            text: '<div/>',
          },
        },
      ],
    });
    expect(r.uiResources[0]?.mimeType).toBe(MCP_UI_HTML_MIME);
  });

  it('skips resource without uri or text', () => {
    const r = extractMcpUiResources({
      content: [
        { type: 'resource', resource: { uri: 'ui://x', mimeType: MCP_UI_HTML_MIME } },
        { type: 'resource', resource: { mimeType: MCP_UI_HTML_MIME, text: '<x/>' } },
      ],
    });
    expect(r.uiResources).toHaveLength(0);
  });

  it('skips non-ui resources (e.g. plain text resources)', () => {
    const r = extractMcpUiResources({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'file:///doc.txt',
            mimeType: 'text/plain',
            text: 'hello',
          },
        },
      ],
    });
    expect(r.uiResources).toHaveLength(0);
  });

  it('hasMcpUiResources mirrors uiResources presence', () => {
    expect(
      hasMcpUiResources({
        content: [
          {
            type: 'resource',
            resource: { uri: 'ui://x', mimeType: MCP_UI_HTML_MIME, text: '<x/>' },
          },
        ],
      }),
    ).toBe(true);
    expect(hasMcpUiResources({ content: [{ type: 'text', text: 'hi' }] })).toBe(false);
  });
});
