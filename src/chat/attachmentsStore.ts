import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT_PER_TURN,
  captureAttachments,
  type Attachment,
  type AttachmentRejectReason,
  type CaptureFileInput,
} from './attachments';

export interface AttachmentsStoreOptions {
  readonly maxBytes?: number;
  readonly maxCount?: number;
  readonly createObjectURL?: (bytes: Uint8Array, mimeType: string) => string;
  readonly revokeObjectURL?: (url: string) => void;
  readonly idFactory?: () => string;
}

export interface StagedAttachment extends Attachment {
  readonly previewUrl: string | null;
}

export interface CaptureOutcome {
  readonly staged: readonly StagedAttachment[];
  readonly rejected: readonly { readonly name: string; readonly reason: AttachmentRejectReason }[];
}

export class AttachmentsStore {
  private readonly maxBytes: number;
  private readonly maxCount: number;
  private readonly create: ((bytes: Uint8Array, mime: string) => string) | null;
  private readonly revoke: (url: string) => void;
  private readonly idFactory: (() => string) | undefined;
  private items: StagedAttachment[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(opts: AttachmentsStoreOptions = {}) {
    this.maxBytes = opts.maxBytes ?? ATTACHMENT_MAX_BYTES;
    this.maxCount = opts.maxCount ?? ATTACHMENT_MAX_COUNT_PER_TURN;
    this.create = opts.createObjectURL ?? defaultCreateObjectURL;
    this.revoke = opts.revokeObjectURL ?? defaultRevokeObjectURL;
    this.idFactory = opts.idFactory;
  }

  getSnapshot(): readonly StagedAttachment[] {
    return this.items;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  capture(files: readonly CaptureFileInput[]): CaptureOutcome {
    const captureOpts = {
      current: this.items,
      maxBytes: this.maxBytes,
      maxCount: this.maxCount,
      ...(this.idFactory !== undefined ? { idFactory: this.idFactory } : {}),
    };
    const { attachments, rejected } = captureAttachments(files, captureOpts);
    const staged: StagedAttachment[] = attachments.map((a) => {
      const previewUrl =
        a.kind === 'image' && this.create !== null
          ? this.safeCreateObjectURL(a.bytes, a.mimeType)
          : null;
      return { ...a, previewUrl };
    });
    if (staged.length > 0) {
      this.items = [...this.items, ...staged];
      this.emit();
    }
    return { staged, rejected };
  }

  remove(id: string): boolean {
    const target = this.items.find((a) => a.id === id);
    if (target === undefined) return false;
    this.items = this.items.filter((a) => a.id !== id);
    if (target.previewUrl !== null) this.safeRevoke(target.previewUrl);
    this.emit();
    return true;
  }

  drainForNext(): readonly Attachment[] {
    const items = this.items;
    this.items = [];
    const plain: Attachment[] = items.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      mimeType: a.mimeType,
      bytes: a.bytes,
      size: a.size,
      ...(a.path !== undefined ? { path: a.path } : {}),
    }));
    for (const a of items) {
      if (a.previewUrl !== null) this.safeRevoke(a.previewUrl);
    }
    if (items.length > 0) this.emit();
    return plain;
  }

  dispose(): void {
    for (const a of this.items) {
      if (a.previewUrl !== null) this.safeRevoke(a.previewUrl);
    }
    this.items = [];
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private safeCreateObjectURL(bytes: Uint8Array, mimeType: string): string | null {
    if (this.create === null) return null;
    try {
      return this.create(bytes, mimeType);
    } catch {
      return null;
    }
  }

  private safeRevoke(url: string): void {
    try {
      this.revoke(url);
    } catch {
      /* ignore */
    }
  }
}

function defaultCreateObjectURL(bytes: Uint8Array, mimeType: string): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return `data:${mimeType};base64,`;
  }
  const slice = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([slice], { type: mimeType });
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectURL(url: string): void {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}
