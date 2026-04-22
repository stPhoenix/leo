import type { ReactNode } from 'react';

export interface HeaderBarProps {
  readonly collapsed: boolean;
  readonly onOverflowMenu?: (anchor: HTMLElement) => void;
  readonly skillPicker?: ReactNode;
}

export function HeaderBar(props: HeaderBarProps): JSX.Element {
  return (
    <header className="leo-header-bar" role="banner" data-region="header">
      <span className="leo-header-title">Leo</span>
      <div className="leo-header-slots">
        <span className="leo-header-skill-slot">{props.skillPicker ?? null}</span>
        <span
          className="leo-header-status-slot"
          role="status"
          aria-live="polite"
          data-slot="streaming-status"
        />
        {props.collapsed ? (
          <button
            type="button"
            className="leo-header-overflow"
            aria-label="More actions"
            onClick={(e) => props.onOverflowMenu?.(e.currentTarget)}
          >
            …
          </button>
        ) : (
          <span className="leo-header-action-slot" data-slot="header-actions" />
        )}
      </div>
    </header>
  );
}
