import type { SlashCommandInfo } from './slashCommands';

export interface SlashPickerItem extends SlashCommandInfo {
  readonly matches: readonly number[];
}

export interface SlashPickerProps {
  readonly items: readonly SlashPickerItem[];
  readonly activeIndex: number;
  readonly onSelect: (item: SlashPickerItem) => void;
  readonly onHover: (index: number) => void;
}

export function SlashPicker(props: SlashPickerProps): JSX.Element | null {
  if (props.items.length === 0) return null;
  return (
    <ul
      className="leo-slash-picker"
      // NOSONAR S6819,S6842 — combobox-style filter picker; native <datalist> filter doesn't fit our fuzzy scorer
      role="listbox"
      aria-label="slash commands"
      data-slot="slash-picker"
    >
      {props.items.map((item, i) => (
        <li
          key={item.name}
          className={i === props.activeIndex ? 'leo-slash-item is-active' : 'leo-slash-item'}
          // NOSONAR S6842 — combobox-style option in custom filter picker
          role="option"
          aria-selected={i === props.activeIndex ? 'true' : 'false'}
          data-slot="slash-item"
          data-slash-name={item.name}
          onMouseDown={(e) => {
            e.preventDefault();
            props.onSelect(item);
          }}
          onMouseEnter={() => props.onHover(i)}
        >
          <span className="leo-slash-name" data-slot="slash-name">
            {highlightMatches(
              `/${item.name}`,
              item.matches.map((m) => m + 1),
            )}
          </span>
          <span className="leo-slash-description" data-slot="slash-description">
            {item.description}
          </span>
        </li>
      ))}
    </ul>
  );
}

function highlightMatches(text: string, indices: readonly number[]): JSX.Element[] {
  const set = new Set(indices);
  const out: JSX.Element[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? '';
    if (set.has(i)) {
      out.push(
        <mark key={i} className="leo-slash-match">
          {char}
        </mark>,
      );
    } else {
      out.push(<span key={i}>{char}</span>);
    }
  }
  return out;
}
