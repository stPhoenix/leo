import type { ChatMessage, ChatMessageContent } from './types';
import type { ContentBlock } from '@/chat/types';

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
]);

function isTextMime(mediaType: string): boolean {
  if (TEXT_MIME_EXACT.has(mediaType)) return true;
  return TEXT_MIME_PREFIXES.some((p) => mediaType.startsWith(p));
}

function base64ToText(b64: string): string {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function inlineDocumentAsText(block: ContentBlock & { type: 'document' }): string {
  const mt = block.source.media_type;
  const nameAttr = block.name !== undefined ? ` name="${block.name}"` : '';
  if (isTextMime(mt)) {
    try {
      const text = base64ToText(block.source.data);
      return `\n\n[document mime=${mt}${nameAttr}]\n${text}\n[/document]\n`;
    } catch {
      /* fall through to placeholder */
    }
  }
  const approxBytes = block.size ?? Math.floor((block.source.data.length * 3) / 4);
  return `\n\n[document mime=${mt}${nameAttr} bytes=${approxBytes} — content omitted; the current provider does not accept document attachments]\n`;
}

export function normalizeForOpenAI(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => ({ ...m, content: normalizeContent(m.content) }));
}

function normalizeContent(content: ChatMessageContent): ChatMessageContent {
  if (typeof content === 'string') return content;
  const out: ContentBlock[] = [];
  const appendText = (text: string): void => {
    const last = out[out.length - 1];
    if (last?.type === 'text') {
      out[out.length - 1] = { type: 'text', text: last.text + text };
    } else {
      out.push({ type: 'text', text });
    }
  };
  for (const b of content) {
    if (b.type === 'text') {
      appendText(b.text);
      continue;
    }
    if (b.type === 'document') {
      appendText(inlineDocumentAsText(b));
      continue;
    }
    out.push(b);
  }
  if (out.length === 0) return '';
  if (out.length === 1 && out[0]!.type === 'text') {
    return (out[0] as { type: 'text'; text: string }).text;
  }
  return out;
}
