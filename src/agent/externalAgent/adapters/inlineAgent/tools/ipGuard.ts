// IP parsing, CIDR matching, and DNS-resolve guard for inline-agent fetch_url.
// Pure module (DNS path is async + side-effecting at runtime only). No imports
// from runtime plugin layers — adapter isolation per NFR-EXT-02.

export type ParsedIp =
  | { readonly kind: 'v4'; readonly n: number }
  | { readonly kind: 'v6'; readonly hi: bigint; readonly lo: bigint };

const V4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIp(input: string): ParsedIp | null {
  if (input.length === 0) return null;
  const stripped = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input;
  const v4 = parseV4(stripped);
  if (v4 !== null) return { kind: 'v4', n: v4 };
  const v6 = parseV6(stripped);
  if (v6 !== null) return { kind: 'v6', hi: v6.hi, lo: v6.lo };
  return null;
}

function parseV4(s: string): number | null {
  const m = V4_REGEX.exec(s);
  if (m === null) return null;
  let n = 0;
  for (let i = 1; i <= 4; i += 1) {
    const part = m[i];
    if (part === undefined) return null;
    const v = Number(part);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = (n * 256 + v) >>> 0;
  }
  return n >>> 0;
}

function parseV6(s: string): { hi: bigint; lo: bigint } | null {
  if (!s.includes(':')) return null;
  const folded = foldMappedV4Suffix(s);
  if (folded === null) return null;
  const expanded = expandDoubleColon(folded);
  if (expanded === null) return null;
  if (expanded.length !== 8) return null;
  return packV6Groups(expanded);
}

function foldMappedV4Suffix(s: string): string | null {
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (!tail.includes('.')) return s;
  const v4 = parseV4(tail);
  if (v4 === null) return null;
  const hi16 = (v4 >>> 16) & 0xffff;
  const lo16 = v4 & 0xffff;
  return `${s.slice(0, lastColon + 1)}${hi16.toString(16)}:${lo16.toString(16)}`;
}

function expandDoubleColon(s: string): string[] | null {
  const dblIdx = s.indexOf('::');
  if (dblIdx !== s.lastIndexOf('::')) return null;
  if (dblIdx < 0) return s.split(':');
  const left = s.slice(0, dblIdx);
  const right = s.slice(dblIdx + 2);
  const leftGroups = left.length > 0 ? left.split(':') : [];
  const rightGroups = right.length > 0 ? right.split(':') : [];
  const fillCount = 8 - leftGroups.length - rightGroups.length;
  if (fillCount < 0) return null;
  return [...leftGroups, ...new Array<string>(fillCount).fill('0'), ...rightGroups];
}

function packV6Groups(groups: readonly string[]): { hi: bigint; lo: bigint } | null {
  let hi = 0n;
  let lo = 0n;
  for (let i = 0; i < 8; i += 1) {
    const g = groups[i];
    if (g === undefined || g.length === 0 || g.length > 4) return null;
    if (!/^[0-9a-fA-F]+$/.test(g)) return null;
    const v = BigInt(parseInt(g, 16));
    if (i < 4) hi = (hi << 16n) | v;
    else lo = (lo << 16n) | v;
  }
  return { hi, lo };
}

export function isCidr(pattern: string): boolean {
  const slash = pattern.indexOf('/');
  if (slash < 0) return false;
  const host = pattern.slice(0, slash);
  const prefix = pattern.slice(slash + 1);
  if (!/^\d+$/.test(prefix)) return false;
  return parseIp(host) !== null;
}

export function cidrContains(cidr: string, ip: string): boolean {
  const slash = cidr.indexOf('/');
  if (slash < 0) return false;
  const baseStr = cidr.slice(0, slash);
  const prefixStr = cidr.slice(slash + 1);
  const prefixLen = Number(prefixStr);
  if (!Number.isFinite(prefixLen) || prefixLen < 0) return false;
  const base = parseIp(baseStr);
  const target = parseIp(ip);
  if (base === null || target === null) return false;
  if (base.kind !== target.kind) return false;
  if (base.kind === 'v4') {
    if (prefixLen > 32) return false;
    if (prefixLen === 0) return true;
    const mask = prefixLen === 32 ? 0xffffffff : (~0 << (32 - prefixLen)) >>> 0;
    return (base.n & mask) === ((target as { kind: 'v4'; n: number }).n & mask);
  }
  if (prefixLen > 128) return false;
  if (prefixLen === 0) return true;
  const t = target as { kind: 'v6'; hi: bigint; lo: bigint };
  if (prefixLen <= 64) {
    const shift = BigInt(64 - prefixLen);
    const mask = ((1n << BigInt(prefixLen)) - 1n) << shift;
    return (base.hi & mask) === (t.hi & mask);
  }
  const shift = BigInt(128 - prefixLen);
  const loMask = ((1n << BigInt(prefixLen - 64)) - 1n) << shift;
  return base.hi === t.hi && (base.lo & loMask) === (t.lo & loMask);
}

// NOSONAR(typescript:S1313): RFC1918 / link-local / CGNAT / IPv6 ULA CIDRs intentionally hardcoded — SSRF guard for fetchUrl.
const PRIVATE_V4_CIDRS = [
  '127.0.0.0/8',
  '0.0.0.0/8',
  '10.0.0.0/8', // NOSONAR(typescript:S1313)
  '172.16.0.0/12', // NOSONAR(typescript:S1313)
  '192.168.0.0/16', // NOSONAR(typescript:S1313)
  '100.64.0.0/10', // NOSONAR(typescript:S1313)
  '169.254.0.0/16', // NOSONAR(typescript:S1313)
] as const;

const PRIVATE_V6_CIDRS = ['::1/128', 'fc00::/7', 'fe80::/10', '64:ff9b::/96'] as const; // NOSONAR(typescript:S1313): IPv6 loopback + ULA + link-local + NAT64 ranges, SSRF guard.

const IPV4_MAPPED_V6_PREFIX = '::ffff:0:0/96'; // NOSONAR(typescript:S1313): RFC 4291 IPv4-mapped IPv6 prefix; SSRF re-check guard.

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const parsed = parseIp(ip);
  if (parsed === null) return false;
  if (parsed.kind === 'v4') {
    return PRIVATE_V4_CIDRS.some((c) => cidrContains(c, ip));
  }
  if (cidrContains(IPV4_MAPPED_V6_PREFIX, ip)) {
    const lo = parsed.lo;
    const v4n = Number(lo & 0xffffffffn);
    const a = (v4n >>> 24) & 0xff;
    const b = (v4n >>> 16) & 0xff;
    const c = (v4n >>> 8) & 0xff;
    const d = v4n & 0xff;
    return PRIVATE_V4_CIDRS.some((cidr) => cidrContains(cidr, `${a}.${b}.${c}.${d}`));
  }
  return PRIVATE_V6_CIDRS.some((c) => cidrContains(c, ip));
}

export type ResolveCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'private' | 'resolve_failed' | 'unsupported' };

export interface DnsLookupAddr {
  readonly address: string;
  readonly family: number;
}

export type DnsLookupAll = (host: string) => Promise<readonly DnsLookupAddr[]>;

let cachedLookup: DnsLookupAll | null | undefined;

async function loadDnsLookup(): Promise<DnsLookupAll | null> {
  if (cachedLookup !== undefined) return cachedLookup;
  try {
    // `dns` is externalized via builtin-modules and resolved by Electron's
    // renderer `require`. The previous `await import('node:dns/promises')`
    // path threw in the renderer's CJS bundle (subpath not externalized,
    // dynamic ESM specifier unreliable), causing every fetch to fail closed
    // with reason='unsupported'.
    const req = (globalThis as { require?: (id: string) => unknown }).require;
    if (typeof req !== 'function') {
      cachedLookup = null;
      return cachedLookup;
    }
    const mod = req('dns') as {
      readonly promises: {
        readonly lookup: (host: string, opts: { all: true }) => Promise<readonly DnsLookupAddr[]>;
      };
    };
    cachedLookup = (host) => mod.promises.lookup(host, { all: true });
  } catch {
    cachedLookup = null;
  }
  return cachedLookup;
}

export interface ResolveAndCheckOptions {
  readonly lookup?: DnsLookupAll;
  readonly enabled?: boolean;
}

export async function resolveAndCheck(
  host: string,
  opts: ResolveAndCheckOptions = {},
): Promise<ResolveCheckResult> {
  if (opts.enabled === false) return { ok: true };
  const stripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const literal = parseIp(stripped);
  if (literal !== null) {
    return isPrivateOrLoopbackIp(stripped) ? { ok: false, reason: 'private' } : { ok: true };
  }
  const lookup = opts.lookup ?? (await loadDnsLookup());
  if (lookup === null) return { ok: false, reason: 'unsupported' };
  let addrs: readonly DnsLookupAddr[];
  try {
    addrs = await lookup(stripped);
  } catch {
    return { ok: false, reason: 'resolve_failed' };
  }
  for (const a of addrs) {
    if (isPrivateOrLoopbackIp(a.address)) return { ok: false, reason: 'private' };
  }
  return { ok: true };
}
