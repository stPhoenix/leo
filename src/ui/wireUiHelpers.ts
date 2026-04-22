import {
  Notifications,
  type NotificationsDeps,
  type NoticeChannel,
  type StatusBarFactory,
  type InlineDialogHost,
  type InlineConfirmationHost,
  type BlockingErrorContent,
  type ToolConfirmationRequest,
} from './notifications';
import {
  applyVisualState,
  ariaHintFor,
  type VisualState,
  type VisualStateAriaHint,
} from './visualStates';
import { iconFor, renderToolIcon, type ToolIconInfo, type ToolIconRender } from './toolIcons';

export type {
  BlockingErrorContent,
  InlineConfirmationHost,
  InlineDialogHost,
  NoticeChannel,
  StatusBarFactory,
  ToolConfirmationRequest,
  ToolIconInfo,
  ToolIconRender,
  VisualState,
  VisualStateAriaHint,
};

export interface WireUiHelpersOptions extends NotificationsDeps {}

export interface UiHelpersWiring {
  readonly hub: Notifications;
  applyVisualState(el: HTMLElement, state: VisualState): void;
  ariaHintFor(state: VisualState): VisualStateAriaHint;
  iconFor(toolId: string): ToolIconInfo;
  renderToolIcon(input: {
    toolId: string;
    labels?: (key: string) => string | null;
  }): ToolIconRender;
  dispose(): void;
}

export function wireUiHelpers(opts: WireUiHelpersOptions): UiHelpersWiring {
  const hub = new Notifications(opts);
  let disposed = false;
  return {
    hub,
    applyVisualState,
    ariaHintFor,
    iconFor,
    renderToolIcon,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      hub.dispose();
    },
  };
}
