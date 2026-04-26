export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT_PER_TURN = 4;

export type AttachmentKind = 'image' | 'document';

export interface Attachment {
  readonly id: string;
  readonly kind: AttachmentKind;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly size: number;
}

export type AttachmentRejectReason =
  | { readonly kind: 'oversize'; readonly size: number }
  | { readonly kind: 'limit_reached'; readonly currentCount: number }
  | { readonly kind: 'unsupported_mime'; readonly mimeType: string };

export interface CaptureResult {
  readonly attachments: readonly Attachment[];
  readonly rejected: readonly { readonly name: string; readonly reason: AttachmentRejectReason }[];
}

export interface CaptureFileInput {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly size: number;
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
  const idFactory = opts.idFactory ?? (() => `att-${Math.random().toString(36).slice(2, 9)}`);
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

export function buildUserContent(
  text: string,
  attachments: readonly Attachment[],
  base64: (bytes: Uint8Array) => string,
): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text }];
  for (const a of attachments) {
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
  }
  return blocks;
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
    else sum += IMAGE_DOCUMENT_TOKENS;
  }
  return sum;
}

export interface VisionGateInput {
  readonly attachments: readonly Attachment[];
  readonly modelSupportsVision: boolean;
}

export function isVisionGateBlocked(input: VisionGateInput): boolean {
  if (input.modelSupportsVision) return false;
  return input.attachments.some((a) => a.kind === 'image');
}
