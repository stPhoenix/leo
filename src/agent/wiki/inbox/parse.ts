export type InboxRowStatus = 'open' | 'done' | 'error';

export interface InboxRow {
  readonly status: InboxRowStatus;
  readonly ref: string;
  readonly note: string | null;
  readonly raw: string;
  readonly lineIndex: number;
}

export interface ParsedInbox {
  readonly rows: readonly InboxRow[];
  readonly otherLines: readonly { readonly lineIndex: number; readonly raw: string }[];
}

export const INBOX_TABLE_HEADER = '| Source | Status | Note |';
export const INBOX_TABLE_SEPARATOR = '| ------ | ------ | ---- |';

const PIPE_LINE_REGEX = /^\s*\|.*\|\s*$/;
const SEPARATOR_REGEX = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const HAS_HEADER_REGEX = /\|\s*Source\s*\|\s*Status\s*\|\s*Note\s*\|/i;

function splitCells(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

function escapeCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function isHeaderCells(cells: readonly string[]): boolean {
  if (cells.length < 3) return false;
  return (
    cells[0]?.toLowerCase() === 'source' &&
    cells[1]?.toLowerCase() === 'status' &&
    cells[2]?.toLowerCase() === 'note'
  );
}

function parseStatus(s: string): InboxRowStatus {
  const lower = s.toLowerCase();
  if (lower === 'done' || lower === 'error') return lower;
  return 'open';
}

export function parseInbox(text: string): ParsedInbox {
  const rows: InboxRow[] = [];
  const others: { lineIndex: number; raw: string }[] = [];
  const lines = text.split(/\r?\n/);
  let headerSeen = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (!PIPE_LINE_REGEX.test(raw)) {
      others.push({ lineIndex: i, raw });
      continue;
    }
    if (SEPARATOR_REGEX.test(raw)) {
      others.push({ lineIndex: i, raw });
      continue;
    }
    const cells = splitCells(raw);
    if (isHeaderCells(cells)) {
      others.push({ lineIndex: i, raw });
      headerSeen = true;
      continue;
    }
    if (!headerSeen || cells.length < 3) {
      others.push({ lineIndex: i, raw });
      continue;
    }
    const ref = cells[0] ?? '';
    if (ref.length === 0) {
      others.push({ lineIndex: i, raw });
      continue;
    }
    const status = parseStatus(cells[1] ?? '');
    const noteCell = (cells[2] ?? '').trim();
    rows.push({
      status,
      ref,
      note: noteCell.length === 0 ? null : noteCell,
      raw,
      lineIndex: i,
    });
  }
  return { rows, otherLines: others };
}

export function renderRow(row: InboxRow): string {
  const ref = escapeCell(row.ref);
  const note = row.note === null ? '' : escapeCell(row.note);
  return `| ${ref} | ${row.status} | ${note} |`;
}

export function serializeInbox(parsed: ParsedInbox): string {
  const total = parsed.rows.length + parsed.otherLines.length;
  const out: string[] = new Array<string>(total).fill('');
  for (const o of parsed.otherLines) out[o.lineIndex] = o.raw;
  for (const r of parsed.rows) out[r.lineIndex] = renderRow(r);
  return out.join('\n');
}

export function appendRow(text: string, ref: string, note?: string): string {
  const row: InboxRow = {
    status: 'open',
    ref,
    note: note !== undefined && note.length > 0 ? note : null,
    raw: '',
    lineIndex: -1,
  };
  const line = renderRow(row);
  if (text.length === 0) {
    return `${INBOX_TABLE_HEADER}\n${INBOX_TABLE_SEPARATOR}\n${line}\n`;
  }
  const trailingNewline = text.endsWith('\n') ? '' : '\n';
  if (!HAS_HEADER_REGEX.test(text)) {
    return `${text}${trailingNewline}\n${INBOX_TABLE_HEADER}\n${INBOX_TABLE_SEPARATOR}\n${line}\n`;
  }
  return `${text}${trailingNewline}${line}\n`;
}

export function tickRef(text: string, ref: string): string {
  const parsed = parseInbox(text);
  let changed = false;
  const next: InboxRow[] = parsed.rows.map((r) => {
    if (r.ref === ref && r.status === 'open') {
      changed = true;
      return { ...r, status: 'done' as const };
    }
    return r;
  });
  if (!changed) return text;
  return serializeInbox({ ...parsed, rows: next });
}

export function annotateErrorOnRef(text: string, ref: string, code: string, msg: string): string {
  const parsed = parseInbox(text);
  let changed = false;
  const errFragment = `error: ${code}: ${msg}`;
  const next: InboxRow[] = parsed.rows.map((r) => {
    if (r.ref !== ref) return r;
    if (r.status === 'done') return r;
    changed = true;
    const note = r.note === null ? errFragment : `${r.note} — ${errFragment}`;
    return { ...r, status: 'error' as const, note };
  });
  if (!changed) return text;
  return serializeInbox({ ...parsed, rows: next });
}
