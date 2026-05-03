export type InboxRowStatus = 'open' | 'done';

export interface InboxRow {
  readonly status: InboxRowStatus;
  readonly ref: string;
  readonly note: string | null;
  readonly error: { readonly code: string; readonly msg: string } | null;
  /** Original line text — for round-trip serialization fidelity. */
  readonly raw: string;
  /** Zero-based index of this row in the original text. */
  readonly lineIndex: number;
}

export interface ParsedInbox {
  readonly rows: readonly InboxRow[];
  /** Lines whose `lineIndex` did not match any inbox row (preserved verbatim). */
  readonly otherLines: readonly { readonly lineIndex: number; readonly raw: string }[];
}

const ROW_REGEX = /^(\s*)-\s*\[( |x|X)\]\s*(.+?)\s*$/;
const NOTE_REGEX = /<!--\s*(.+?)\s*-->/g;
const ERROR_NOTE_REGEX = /^error:\s*([A-Za-z0-9_:-]+):\s*(.+)$/;

export function parseInbox(text: string): ParsedInbox {
  const rows: InboxRow[] = [];
  const others: { lineIndex: number; raw: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const m = ROW_REGEX.exec(raw);
    if (m === null) {
      others.push({ lineIndex: i, raw });
      continue;
    }
    const status: InboxRowStatus = m[2]?.toLowerCase() === 'x' ? 'done' : 'open';
    const tail = m[3] ?? '';
    const { ref, note, error } = parseRefAndNotes(tail);
    rows.push({ status, ref, note, error, raw, lineIndex: i });
  }
  return { rows, otherLines: others };
}

function parseRefAndNotes(tail: string): {
  ref: string;
  note: string | null;
  error: { code: string; msg: string } | null;
} {
  let note: string | null = null;
  let error: { code: string; msg: string } | null = null;
  const noteMatches = [...tail.matchAll(NOTE_REGEX)];
  let refSlice = tail;
  if (noteMatches.length > 0) {
    refSlice = tail.slice(0, noteMatches[0]!.index ?? tail.length);
    for (const nm of noteMatches) {
      const inner = (nm[1] ?? '').trim();
      const errMatch = ERROR_NOTE_REGEX.exec(inner);
      if (errMatch !== null) {
        error = { code: errMatch[1]!, msg: errMatch[2]!.trim() };
      } else if (note === null) {
        note = inner;
      }
    }
  }
  return { ref: refSlice.trim(), note, error };
}

export function serializeInbox(parsed: ParsedInbox): string {
  const total = parsed.rows.length + parsed.otherLines.length;
  const out: string[] = new Array<string>(total).fill('');
  for (const o of parsed.otherLines) out[o.lineIndex] = o.raw;
  for (const r of parsed.rows) out[r.lineIndex] = renderRow(r);
  return out.join('\n');
}

export function renderRow(row: InboxRow): string {
  const checkbox = row.status === 'done' ? '- [x]' : '- [ ]';
  const parts = [`${checkbox} ${row.ref}`];
  if (row.note !== null) parts.push(`<!-- ${row.note} -->`);
  if (row.error !== null) parts.push(`<!-- error: ${row.error.code}: ${row.error.msg} -->`);
  return parts.join('  ');
}

export function appendRow(text: string, ref: string, note?: string): string {
  const parts: string[] = [`- [ ] ${ref}`];
  if (note !== undefined && note.length > 0) parts.push(`<!-- ${note} -->`);
  const line = parts.join('  ');
  if (text.length === 0) return `${line}\n`;
  return text.endsWith('\n') ? `${text}${line}\n` : `${text}\n${line}\n`;
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

export function annotateErrorOnRef(
  text: string,
  ref: string,
  code: string,
  msg: string,
): string {
  const parsed = parseInbox(text);
  let changed = false;
  const next: InboxRow[] = parsed.rows.map((r) => {
    if (r.ref === ref) {
      changed = true;
      return { ...r, error: { code, msg } };
    }
    return r;
  });
  if (!changed) return text;
  return serializeInbox({ ...parsed, rows: next });
}
