import type { ReactNode } from 'react';

export interface HeaderBarProps {
  readonly collapsed: boolean;
  readonly onOverflowMenu?: (anchor: HTMLElement) => void;
  readonly threadSwitcher?: ReactNode;
  readonly stats?: ReactNode;
  readonly planModeActive?: boolean;
}

export function HeaderBar(props: HeaderBarProps): JSX.Element {
  return (
    <header className="leo-header-bar" role="banner" data-region="header">
      <span className="leo-header-title">Leo</span>
      {props.planModeActive === true ? (
        <span
          className="leo-header-plan-pill"
          data-slot="plan-mode-pill"
          aria-label="Plan mode active"
        >
          Plan mode
        </span>
      ) : null}
      {!props.collapsed && props.stats !== undefined ? (
        <span className="leo-header-stats-slot" data-slot="header-stats">
          {props.stats}
        </span>
      ) : null}
      <div className="leo-header-slots">
        <output
          className="leo-header-status-slot"
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
          <span className="leo-header-action-slot" data-slot="header-actions">
            {props.threadSwitcher ?? null}
          </span>
        )}
      </div>
    </header>
  );
}
