/**
 * Compute SHA-256 hex digest of a string via Web Crypto. NFR-04 — no new dep.
 */
export async function computeSha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('Web Crypto subtle API unavailable');
  }
  const data = new TextEncoder().encode(text);
  const buf = await subtle.digest('SHA-256', data);
  return bufferToHex(buf);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}
