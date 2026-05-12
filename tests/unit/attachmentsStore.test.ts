import { describe, expect, it, vi } from 'vitest';
import { AttachmentsStore } from '@/chat/attachmentsStore';
import { ATTACHMENT_MAX_COUNT_PER_TURN, type CaptureFileInput } from '@/chat/attachments';

function imageFile(name = 'a.png', size = 64, mimeType = 'image/png'): CaptureFileInput {
  return { name, mimeType, size, bytes: new Uint8Array(size) };
}
function docFile(name = 'a.pdf', size = 16, mimeType = 'application/pdf'): CaptureFileInput {
  return { name, mimeType, size, bytes: new Uint8Array(size) };
}

describe('AttachmentsStore', () => {
  it('captures valid files and assigns preview URLs for images only', () => {
    const create = vi.fn((_b: Uint8Array, mime: string) => `blob:${mime}:x`);
    const revoke = vi.fn();
    const store = new AttachmentsStore({
      createObjectURL: create,
      revokeObjectURL: revoke,
      idFactory: mkId(),
    });
    const out = store.capture([imageFile('pic.png'), docFile('spec.pdf')]);
    expect(out.staged).toHaveLength(2);
    expect(out.rejected).toEqual([]);
    const snap = store.getSnapshot();
    expect(snap[0]?.kind).toBe('image');
    expect(snap[0]?.previewUrl).toBe('blob:image/png:x');
    expect(snap[1]?.kind).toBe('document');
    expect(snap[1]?.previewUrl).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects an attachment over ATTACHMENT_MAX_BYTES', () => {
    const store = new AttachmentsStore({ maxBytes: 100 });
    const huge = { ...imageFile('big.png', 200) };
    const out = store.capture([huge]);
    expect(out.staged).toEqual([]);
    expect(out.rejected[0]?.reason.kind).toBe('oversize');
  });

  it('rejects once ATTACHMENT_MAX_COUNT_PER_TURN is reached', () => {
    const store = new AttachmentsStore({ idFactory: mkId() });
    const files: CaptureFileInput[] = [];
    for (let i = 0; i < ATTACHMENT_MAX_COUNT_PER_TURN + 1; i += 1) {
      files.push(imageFile(`p${i}.png`));
    }
    const out = store.capture(files);
    expect(out.staged).toHaveLength(ATTACHMENT_MAX_COUNT_PER_TURN);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]?.reason.kind).toBe('limit_reached');
  });

  it('remove() revokes the blob URL and drops the item', () => {
    const revoke = vi.fn();
    const store = new AttachmentsStore({
      createObjectURL: () => 'blob:one',
      revokeObjectURL: revoke,
      idFactory: mkId(),
    });
    store.capture([imageFile('a.png')]);
    const id = store.getSnapshot()[0]!.id;
    expect(store.remove(id)).toBe(true);
    expect(store.getSnapshot()).toEqual([]);
    expect(revoke).toHaveBeenCalledWith('blob:one');
  });

  it('drainForNext() returns plain Attachments, clears state, and revokes every blob URL', () => {
    const revoke = vi.fn();
    const store = new AttachmentsStore({
      createObjectURL: (_b, m) => `blob:${m}`,
      revokeObjectURL: revoke,
      idFactory: mkId(),
    });
    store.capture([imageFile('a.png'), docFile('b.pdf')]);
    const drained = store.drainForNext();
    expect(drained).toHaveLength(2);
    expect(store.getSnapshot()).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:image/png');
  });

  it('dispose() revokes all outstanding blob URLs', () => {
    const revoke = vi.fn();
    const store = new AttachmentsStore({
      createObjectURL: () => 'blob:x',
      revokeObjectURL: revoke,
      idFactory: mkId(),
    });
    store.capture([imageFile('a.png'), imageFile('b.png')]);
    store.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('subscribe() fires on mutations', () => {
    const store = new AttachmentsStore({ idFactory: mkId() });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.capture([imageFile('a.png')]);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    store.capture([imageFile('b.png')]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('preserves path field through capture and drainForNext', () => {
    const store = new AttachmentsStore({ idFactory: mkId() });
    const withPath: CaptureFileInput = {
      ...imageFile('a.png'),
      path: '.leo/attachments/2026-05-12-x-a.png',
    };
    store.capture([withPath]);
    expect(store.getSnapshot()[0]?.path).toBe('.leo/attachments/2026-05-12-x-a.png');
    const drained = store.drainForNext();
    expect(drained[0]?.path).toBe('.leo/attachments/2026-05-12-x-a.png');
  });
});

function mkId(): () => string {
  let i = 0;
  return () => `id-${i++}`;
}
