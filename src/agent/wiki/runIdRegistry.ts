function pad(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function formatTimestamp(d: Date): string {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}` +
    `-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`
  );
}

function randomTail(length = 6): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, length);
  }
  let out = '';
  while (out.length < length) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, length);
}

export interface GenerateWikiRunIdOptions {
  readonly now?: () => Date;
  readonly tail?: () => string;
}

export function generateWikiRunId(opts: GenerateWikiRunIdOptions = {}): string {
  const d = (opts.now ?? ((): Date => new Date()))();
  const tail = (opts.tail ?? ((): string => randomTail(6)))();
  return `${formatTimestamp(d)}-${tail}`;
}
