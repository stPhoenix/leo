// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  Notifications,
  type BlockingErrorContent,
  type InlineConfirmationHost,
  type InlineDialogHost,
  type NoticeChannel,
  type StatusBarChannel,
  type StatusBarFactory,
  type ToolConfirmationRequest,
} from '@/ui/notifications';

function makeFakes() {
  const notice: NoticeChannel = { show: vi.fn() };
  const createdStatusBars: StatusBarChannel[] = [];
  const factory: StatusBarFactory = {
    create: vi.fn(() => {
      let text = '';
      let removed = false;
      const s: StatusBarChannel = {
        setText: vi.fn((t) => {
          text = t;
        }),
        clear: vi.fn(() => {
          text = '';
        }),
        remove: vi.fn(() => {
          removed = true;
        }),
      };
      Object.defineProperty(s, 'current', { get: () => text });
      Object.defineProperty(s, 'isRemoved', { get: () => removed });
      createdStatusBars.push(s);
      return s;
    }),
  };
  const inlineDialog: InlineDialogHost = {
    mount: vi.fn((_host: HTMLElement, _content: BlockingErrorContent) => {
      const dismiss = vi.fn();
      return dismiss;
    }),
    isNativeModal: () => false,
  };
  const inlineConfirmation: InlineConfirmationHost = {
    present: vi.fn((_req: ToolConfirmationRequest) => {
      const dismiss = vi.fn();
      return dismiss;
    }),
    isNativeModal: () => false,
  };
  return { notice, factory, inlineDialog, inlineConfirmation, createdStatusBars };
}

describe('Notifications — channel routing per FR-UI-08', () => {
  it('.notice() calls the Obsidian Notice surface', () => {
    const { notice, factory, inlineDialog, inlineConfirmation } = makeFakes();
    const n = new Notifications({
      notice,
      statusBar: factory,
      inlineDialog,
      inlineConfirmation,
    });
    n.notice('saved');
    expect(notice.show).toHaveBeenCalledWith('saved');
  });

  it('.status(key, message) creates a status-bar item per key and updates its text', () => {
    const { notice, factory, inlineDialog, inlineConfirmation, createdStatusBars } = makeFakes();
    const n = new Notifications({
      notice,
      statusBar: factory,
      inlineDialog,
      inlineConfirmation,
    });
    n.status('provider', 'connecting');
    n.status('provider', 'ready');
    n.status('index', 'rebuilding');
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(createdStatusBars[0]!.setText).toHaveBeenCalledWith('connecting');
    expect(createdStatusBars[0]!.setText).toHaveBeenCalledWith('ready');
    expect(createdStatusBars[1]!.setText).toHaveBeenCalledWith('rebuilding');
  });

  it('.removeStatus() removes the underlying status-bar item', () => {
    const { notice, factory, inlineDialog, inlineConfirmation, createdStatusBars } = makeFakes();
    const n = new Notifications({
      notice,
      statusBar: factory,
      inlineDialog,
      inlineConfirmation,
    });
    n.status('a', 'x');
    n.removeStatus('a');
    expect(createdStatusBars[0]!.remove).toHaveBeenCalled();
  });

  it('.blockingError() mounts into the InlineDialog host (never the native modal API)', () => {
    const { notice, factory, inlineDialog, inlineConfirmation } = makeFakes();
    const n = new Notifications({
      notice,
      statusBar: factory,
      inlineDialog,
      inlineConfirmation,
    });
    const host = document.createElement('div');
    n.blockingError(host, { title: 'error', message: 'something broke' });
    expect(inlineDialog.mount).toHaveBeenCalled();
    expect(inlineDialog.isNativeModal()).toBe(false);
  });

  it('.requestToolConfirmation() is routed exclusively to the inline confirmation host', () => {
    const { notice, factory, inlineDialog, inlineConfirmation } = makeFakes();
    const n = new Notifications({
      notice,
      statusBar: factory,
      inlineDialog,
      inlineConfirmation,
    });
    const resolve = vi.fn();
    n.requestToolConfirmation({ toolId: 'write_note', args: {}, resolve });
    expect(inlineConfirmation.present).toHaveBeenCalledTimes(1);
    expect(inlineConfirmation.isNativeModal()).toBe(false);
  });

  it('.dispose() tears down status bars, active blocking error, and active confirmation', () => {
    const { notice, factory, inlineDialog, inlineConfirmation, createdStatusBars } = makeFakes();
    const dismissDialog = vi.fn();
    (inlineDialog.mount as ReturnType<typeof vi.fn>).mockReturnValueOnce(dismissDialog);
    const dismissConfirm = vi.fn();
    (inlineConfirmation.present as ReturnType<typeof vi.fn>).mockReturnValueOnce(dismissConfirm);
    const n = new Notifications({
      notice,
      statusBar: factory,
      inlineDialog,
      inlineConfirmation,
    });
    n.status('a', 'x');
    n.blockingError(document.createElement('div'), { title: 't', message: 'm' });
    n.requestToolConfirmation({ toolId: 'read_note', args: {}, resolve: () => undefined });
    n.dispose();
    expect(createdStatusBars[0]!.remove).toHaveBeenCalled();
    expect(dismissDialog).toHaveBeenCalled();
    expect(dismissConfirm).toHaveBeenCalled();
  });
});
