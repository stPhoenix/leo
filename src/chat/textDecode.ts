const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
]);

export function isTextDecodableMime(mediaType: string): boolean {
  if (TEXT_MIME_EXACT.has(mediaType)) return true;
  return TEXT_MIME_PREFIXES.some((p) => mediaType.startsWith(p));
}

export function base64ToText(b64: string): string {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf-8');
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
