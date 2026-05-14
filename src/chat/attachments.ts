import { bytesToText, isTextDecodableMime } from './textDecode';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT_PER_TURN = 4;
export const ATTACHMENT_TRUNCATE_TOKENS = 500;
const CHARS_PER_TOKEN = 4;
export const ATTACHMENT_TRUNCATE_CHARS = ATTACHMENT_TRUNCATE_TOKENS * CHARS_PER_TOKEN;

export type AttachmentKind = 'image' | 'document';

export interface Attachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly path?: string;
}

export type AttachmentRejectReason =
  | { readonly kind: 'oversize'; readonly size: number }
  | { readonly kind: 'limit_reached'; readonly currentCount: number }
  | { readonly kind: 'unsupported_mime'; readonly mimeType: string }
  | { readonly kind: 'upload_failed'; readonly message: string };

export interface CaptureResult {
  readonly attachments: readonly Attachment[];
  readonly rejected: readonly { readonly name: string; readonly reason: AttachmentRejectReason }[];
}

export interface CaptureFileInput {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly size: number;
  readonly path?: string;
}

export interface CaptureOptions {
  readonly current: readonly Attachment[];
  readonly maxBytes?: number;
  readonly maxCount?: number;
  readonly idFactory?: () => string;
  readonly documentMimeAllowlist?: readonly string[];
}

const DEFAULT_DOCUMENT_ALLOWLIST = ['application/pdf', 'application/json', 'text/'];

export function captureAttachments(
  files: readonly CaptureFileInput[],
  opts: CaptureOptions,
): CaptureResult {
  const maxBytes = opts.maxBytes ?? ATTACHMENT_MAX_BYTES;
  const maxCount = opts.maxCount ?? ATTACHMENT_MAX_COUNT_PER_TURN;
  const idFactory = opts.idFactory ?? (() => `att-${Math.random().toString(36).slice(2, 9)}`); // NOSONAR(typescript:S2245): non-cryptographic attachment ID for UI lists.
  const allowlist = opts.documentMimeAllowlist ?? DEFAULT_DOCUMENT_ALLOWLIST;
  const accepted: Attachment[] = [];
  const rejected: { name: string; reason: AttachmentRejectReason }[] = [];
  let total = opts.current.length;
  for (const f of files) {
    if (total >= maxCount) {
      rejected.push({ name: f.name, reason: { kind: 'limit_reached', currentCount: total } });
      continue;
    }
    if (f.size > maxBytes) {
      rejected.push({ name: f.name, reason: { kind: 'oversize', size: f.size } });
      continue;
    }
    const isImage = f.mimeType.startsWith('image/');
    if (!isImage) {
      const ok = allowlist.some((a) =>
        a.endsWith('/') ? f.mimeType.startsWith(a) : f.mimeType === a,
      );
      if (!ok) {
        rejected.push({
          name: f.name,
          reason: { kind: 'unsupported_mime', mimeType: f.mimeType },
        });
        continue;
      }
    }
    accepted.push({
      id: idFactory(),
      kind: isImage ? 'image' : 'document',
      name: f.name,
      mimeType: f.mimeType,
      bytes: f.bytes,
      size: f.size,
      ...(f.path !== undefined ? { path: f.path } : {}),
    });
    total += 1;
  }
  return { attachments: accepted, rejected };
}

import type {
  ContentBlock,
  TextBlock as ContentBlockText,
  ImageBlock as ContentBlockImage,
  DocumentBlock as ContentBlockDocument,
} from './types';

export type { ContentBlock, ContentBlockText, ContentBlockImage, ContentBlockDocument };

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function buildTextAttachmentBlock(a: Attachment): ContentBlockText {
  const decoded = bytesToText(a.bytes);
  const totalTokens = estimateTokens(decoded);
  const truncated = totalTokens > ATTACHMENT_TRUNCATE_TOKENS;
  const body = truncated ? decoded.slice(0, ATTACHMENT_TRUNCATE_CHARS) : decoded;
  const pathAttr = a.path !== undefined ? ` path="${a.path}"` : '';
  const nameAttr = ` name="${a.name}"`;
  const mimeAttr = ` mime="${a.mimeType}"`;
  const hint =
    truncated && a.path !== undefined
      ? ` truncated ${ATTACHMENT_TRUNCATE_TOKENS}/${totalTokens} tokens — use read_file path="${a.path}" for full content`
      : truncated
        ? ` truncated ${ATTACHMENT_TRUNCATE_TOKENS}/${totalTokens} tokens — full content unavailable (no path)`
        : '';
  return {
    type: 'text',
    text: `[attachment${pathAttr}${nameAttr}${mimeAttr}${hint}]\n${body}\n[/attachment]`,
  };
}

function buildAttachmentNoteBlock(a: Attachment): ContentBlockText {
  const pathAttr = a.path !== undefined ? ` path="${a.path}"` : '';
  const nameAttr = ` name="${a.name}"`;
  const mimeAttr = ` mime="${a.mimeType}"`;
  const kindLabel = a.kind === 'image' ? 'image' : 'doc';
  const sizeAttr = ` size=${a.size}`;
  const suffix = a.kind === 'image' ? '' : ' — binary, content sent as base64 below';
  return {
    type: 'text',
    text: `[attachment ${kindLabel}${pathAttr}${nameAttr}${mimeAttr}${sizeAttr}${suffix}]`,
  };
}

export function buildUserContent(
  text: string,
  attachments: readonly Attachment[],
  base64: (bytes: Uint8Array) => string,
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text }];
  for (const a of attachments) {
    if (a.kind === 'document' && isTextDecodableMime(a.mimeType)) {
      blocks.push(buildTextAttachmentBlock(a));
      blocks.push(buildChipBlock(a));
      continue;
    }
    blocks.push(buildAttachmentNoteBlock(a));
    if (a.kind === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: a.mimeType,
          data: base64(a.bytes),
        },
        name: a.name,
        size: a.size,
      });
    } else {
      blocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: a.mimeType,
          data: base64(a.bytes),
        },
        name: a.name,
        size: a.size,
      });
    }
    blocks.push(buildChipBlock(a));
  }
  return blocks;
}

function buildChipBlock(a: Attachment): ContentBlock {
  return {
    type: 'attachment_chip',
    kind: a.kind,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    ...(a.path !== undefined ? { path: a.path } : {}),
  };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

export interface VaultDropDetectionInput {
  readonly textPlain?: string;
  readonly fileExists?: (path: string) => boolean;
}

export interface VaultDropResult {
  readonly wikilink: string;
  readonly path: string;
}

export function detectVaultDrop(input: VaultDropDetectionInput): VaultDropResult | null {
  const raw = input.textPlain?.trim();
  if (raw === undefined || raw.length === 0) return null;
  const wrappedMatch = /^\[\[([^\]]+)\]\]$/.exec(raw);
  if (wrappedMatch !== null) {
    return { wikilink: raw, path: wrappedMatch[1]! };
  }
  const looksLikePath = /\.(?:md|canvas|json|ts|tsx|js|jsx|pdf|txt)$/i.test(raw);
  if (!looksLikePath) return null;
  if (input.fileExists !== undefined && !input.fileExists(raw)) return null;
  return { wikilink: `[[${raw}]]`, path: raw };
}

export function estimateAttachmentTokens(blocks: readonly ContentBlock[]): number {
  const IMAGE_DOCUMENT_TOKENS = 2_000;
  let sum = 0;
  for (const b of blocks) {
    if (b.type === 'text') sum += Math.round(b.text.length / 4);
    else if (b.type === 'attachment_chip') continue;
    else sum += IMAGE_DOCUMENT_TOKENS;
  }
  return sum;
}
