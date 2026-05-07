export function slugifyLabel(label: string, max = 50): string {
  const ascii = label
    .toLowerCase()
    .replace(/https?:\/\//g, '') // NOSONAR(typescript:S5852): literal scheme strip, linear.
    .replace(/[^a-z0-9]+/g, '-') // NOSONAR(typescript:S5852): single char class + quantifier, linear.
    .replace(/^-+|-+$/g, '');
  const trimmed = ascii.length === 0 ? 'source' : ascii;
  return trimmed.length > max ? trimmed.slice(0, max).replace(/-+$/, '') : trimmed;
}

function pad(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

export function dateStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

export interface RawPathInput {
  readonly nowDate: Date;
  readonly slugLabel: string;
}

export function buildRawPath(input: RawPathInput): string {
  const slug = slugifyLabel(input.slugLabel);
  return `wiki/raw/${dateStamp(input.nowDate)}-${slug}.md`;
}
