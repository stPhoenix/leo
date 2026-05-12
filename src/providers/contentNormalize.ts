import type { ChatMessage, ChatMessageContent } from './types';
import type { ContentBlock } from '@/chat/types';
import { base64ToText, isTextDecodableMime } from '@/chat/textDecode';

function inlineDocumentAsText(block: ContentBlock & { type: 'document' }): string {
  const mt = block.source.media_type;
  const nameAttr = block.name !== undefined ? ` name="${block.name}"` : '';
  if (isTextDecodableMime(mt)) {
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
