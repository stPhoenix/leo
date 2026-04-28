import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ThreadsSnapshot } from '@/storage/threadsStore';

export interface ThreadsUiSource {
  readonly subscribe: (cb: () => void) => () => void;
  readonly getSnapshot: () => ThreadsSnapshot;
  readonly create: () => Promise<string>;
  readonly switch: (id: string) => Promise<void>;
  readonly rename: (id: string, title: string) => Promise<void>;
  readonly delete: (id: string) => Promise<void>;
}

export interface ThreadSwitcherProps {
  readonly source: ThreadsUiSource;
}

export function ThreadSwitcher(props: ThreadSwitcherProps): JSX.Element {
  const snapshot = useSyncExternalStore(
    props.source.subscribe,
    props.source.getSnapshot,
    props.source.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { activeId, summaries } = snapshot;
  const active = summaries.find((s) => s.id === activeId) ?? null;
  const activeTitle = active?.title ?? 'New thread';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const root = rootRef.current;
      if (root !== null && !root.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleNew = (): void => {
    void props.source.create();
    setOpen(false);
  };

  const handleSwitch = (id: string): void => {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    void props.source.switch(id);
    setOpen(false);
  };

  const handleDelete = (id: string): void => {
    void props.source.delete(id);
  };

  const handleRename = (id: string, value: string): void => {
    const trimmed = value.trim();
    setRenamingId(null);
    if (trimmed.length === 0) return;
    void props.source.rename(id, trimmed);
  };

  return (
    <div ref={rootRef} className="leo-thread-switcher" data-region="thread-switcher">
      <button
        type="button"
        className="leo-thread-switcher-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Active thread: ${activeTitle}`}
        onClick={() => setOpen((v) => !v)}
        title={`Active thread: ${activeTitle}`}
      >
        <span className="leo-thread-switcher-title">{activeTitle}</span>
        <span className="leo-thread-switcher-caret" aria-hidden>
          ▾
        </span>
      </button>
      <button
        type="button"
        className="leo-thread-switcher-new"
        aria-label="New thread"
        title="New thread"
        onClick={handleNew}
      >
        +
      </button>
      {open ? (
        <ul className="leo-thread-switcher-list" role="listbox" aria-label="Chat threads">
          {summaries.length === 0 ? (
            <li className="leo-thread-switcher-empty">No threads</li>
          ) : (
            summaries.map((s) => {
              const isActive = s.id === activeId;
              const isRenaming = renamingId === s.id;
              return (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={isActive}
                  className={`leo-thread-switcher-item${isActive ? ' is-active' : ''}`}
                >
                  {isRenaming ? (
                    <input
                      type="text"
                      className="leo-thread-switcher-rename-input"
                      defaultValue={s.title}
                      autoFocus
                      onBlur={(e) => handleRename(s.id, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(s.id, e.currentTarget.value);
                        else if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="leo-thread-switcher-item-label"
                      onClick={() => handleSwitch(s.id)}
                      onDoubleClick={() => setRenamingId(s.id)}
                      title={`${s.title} · ${s.messageCount} message${s.messageCount === 1 ? '' : 's'}`}
                    >
                      {s.title}
                    </button>
                  )}
                  {isRenaming ? null : (
                    <button
                      type="button"
                      className="leo-thread-switcher-item-rename"
                      aria-label={`Rename ${s.title}`}
                      title="Rename thread"
                      onClick={() => setRenamingId(s.id)}
                    >
                      ✎
                    </button>
                  )}
                  <button
                    type="button"
                    className="leo-thread-switcher-item-delete"
                    aria-label={`Delete ${s.title}`}
                    title="Delete thread"
                    onClick={() => handleDelete(s.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
