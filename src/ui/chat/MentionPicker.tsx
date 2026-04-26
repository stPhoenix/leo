import { useEffect, useRef } from 'react';

export interface MentionPickerItem {
  readonly path: string;
  readonly name: string;
  readonly kind: 'image' | 'document';
  readonly matches: readonly number[];
}

export interface MentionPickerProps {
  readonly items: readonly MentionPickerItem[];
  readonly activeIndex: number;
  readonly onSelect: (item: MentionPickerItem) => void;
  readonly onHover: (index: number) => void;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export function MentionPicker(props: MentionPickerProps): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <ul
      className="leo-mention-picker"
      role="listbox"
      aria-label="vault file mentions"
      data-slot="mention-picker"
    >
      {props.items.map((item, i) => (
        <MentionRow
          key={item.path}
          item={item}
          active={i === props.activeIndex}
          onSelect={() => props.onSelect(item)}
          onHover={() => props.onHover(i)}
          setIcon={props.setIcon}
        />
      ))}
    </ul>
  );
}

function MentionRow(props: {
  readonly item: MentionPickerItem;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly onHover: () => void;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}): JSX.Element {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const { item } = props;
  const folder = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';

  useEffect(() => {
    const el = iconRef.current;
    if (el === null) return;
    el.replaceChildren();
    const glyph = item.kind === 'image' ? 'image' : 'file-text';
    if (props.setIcon !== undefined) props.setIcon(el, glyph);
    else el.textContent = item.kind === 'image' ? '🖼' : '📄';
  }, [item.kind, props.setIcon]);

  return (
    <li
      className={props.active ? 'leo-mention-item is-active' : 'leo-mention-item'}
      role="option"
      aria-selected={props.active ? 'true' : 'false'}
      data-slot="mention-item"
      data-path={item.path}
      onMouseDown={(e) => {
        e.preventDefault();
        props.onSelect();
      }}
      onMouseEnter={props.onHover}
    >
      <span ref={iconRef} className="leo-mention-icon" data-slot="mention-icon" />
      <span className="leo-mention-name" data-slot="mention-name">
        {highlightMatches(item.name, item.matches)}
      </span>
      {folder.length > 0 ? (
        <span className="leo-mention-folder" data-slot="mention-folder">
          {folder}
        </span>
      ) : null}
    </li>
  );
}

function highlightMatches(text: string, indices: readonly number[]): JSX.Element[] {
  const set = new Set(indices);
  const out: JSX.Element[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (set.has(i)) {
      out.push(
        <mark key={i} className="leo-mention-match">
          {char}
        </mark>,
      );
    } else {
      out.push(<span key={i}>{char}</span>);
    }
  }
  return out;
}
