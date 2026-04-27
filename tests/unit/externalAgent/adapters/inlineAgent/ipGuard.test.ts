import { describe, expect, it, vi } from 'vitest';
import {
  cidrContains,
  isCidr,
  isPrivateOrLoopbackIp,
  parseIp,
  resolveAndCheck,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/ipGuard';

describe('parseIp', () => {
  it('parses IPv4', () => {
    expect(parseIp('127.0.0.1')).toEqual({ kind: 'v4', n: 0x7f000001 });
    expect(parseIp('255.255.255.255')).toEqual({ kind: 'v4', n: 0xffffffff });
    expect(parseIp('256.0.0.1')).toBeNull();
    expect(parseIp('not-an-ip')).toBeNull();
  });

  it('parses IPv6 full + compressed', () => {
    expect(parseIp('::1')?.kind).toBe('v6');
    expect(parseIp('fe80::1')?.kind).toBe('v6');
    expect(parseIp('fc00::1')?.kind).toBe('v6');
    expect(parseIp('2001:db8::1')?.kind).toBe('v6');
  });

  it('parses IPv4-mapped IPv6 (::ffff:a.b.c.d)', () => {
    const p = parseIp('::ffff:127.0.0.1');
    expect(p?.kind).toBe('v6');
  });

  it('strips brackets', () => {
    expect(parseIp('[::1]')?.kind).toBe('v6');
  });

  it('rejects more than one ::', () => {
    expect(parseIp('1::2::3')).toBeNull();
  });
});

describe('isCidr / cidrContains (IPv4)', () => {
  it('matches v4 CIDR', () => {
    expect(isCidr('10.0.0.0/8')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '10.5.6.7')).toBe(true);
    expect(cidrContains('10.0.0.0/8', '11.0.0.1')).toBe(false);
    expect(cidrContains('192.168.1.0/24', '192.168.1.42')).toBe(true);
    expect(cidrContains('192.168.1.0/24', '192.168.2.1')).toBe(false);
  });

  it('handles /0 and /32', () => {
    expect(cidrContains('0.0.0.0/0', '8.8.8.8')).toBe(true);
    expect(cidrContains('1.2.3.4/32', '1.2.3.4')).toBe(true);
    expect(cidrContains('1.2.3.4/32', '1.2.3.5')).toBe(false);
  });
});

describe('isCidr / cidrContains (IPv6)', () => {
  it('matches v6 CIDR with prefix <= 64', () => {
    expect(cidrContains('fc00::/7', 'fd12::1')).toBe(true);
    expect(cidrContains('fc00::/7', 'fb00::1')).toBe(false);
    expect(cidrContains('fe80::/10', 'fe80::abcd')).toBe(true);
    expect(cidrContains('fe80::/10', 'fec0::1')).toBe(false);
  });

  it('matches v6 CIDR with prefix > 64', () => {
    expect(cidrContains('::1/128', '::1')).toBe(true);
    expect(cidrContains('::1/128', '::2')).toBe(false);
    expect(cidrContains('::ffff:0:0/96', '::ffff:127.0.0.1')).toBe(true);
    expect(cidrContains('::ffff:0:0/96', '::ffff:8.8.8.8')).toBe(true);
    expect(cidrContains('::ffff:0:0/96', '2001:db8::1')).toBe(false);
  });

  it('rejects mixed-family compares', () => {
    expect(cidrContains('10.0.0.0/8', '::1')).toBe(false);
    expect(cidrContains('::1/128', '127.0.0.1')).toBe(false);
  });
});

describe('isPrivateOrLoopbackIp', () => {
  const PRIVATE_V4 = [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.169.254',
    '0.0.0.0',
  ];
  const PUBLIC_V4 = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1'];

  for (const ip of PRIVATE_V4) {
    it(`flags ${ip} as private`, () => {
      expect(isPrivateOrLoopbackIp(ip)).toBe(true);
    });
  }
  for (const ip of PUBLIC_V4) {
    it(`accepts ${ip} as public`, () => {
      expect(isPrivateOrLoopbackIp(ip)).toBe(false);
    });
  }

  it('flags IPv6 loopback / ULA / link-local', () => {
    expect(isPrivateOrLoopbackIp('::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('fd00::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('fe80::1')).toBe(true);
  });

  it('flags IPv4-mapped private (::ffff:127.0.0.1)', () => {
    expect(isPrivateOrLoopbackIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('returns false for non-IP strings', () => {
    expect(isPrivateOrLoopbackIp('example.com')).toBe(false);
  });
});

describe('resolveAndCheck', () => {
  it('passes for public IP literal without calling lookup', async () => {
    const lookup = vi.fn();
    const out = await resolveAndCheck('8.8.8.8', { lookup });
    expect(out).toEqual({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects for private IP literal', async () => {
    const out = await resolveAndCheck('127.0.0.1');
    expect(out).toEqual({ ok: false, reason: 'private' });
  });

  it('rejects when DNS resolves to a private IP', async () => {
    const out = await resolveAndCheck('rebind.example', {
      lookup: async () => [{ address: '10.0.0.1', family: 4 }],
    });
    expect(out).toEqual({ ok: false, reason: 'private' });
  });

  it('resolve_failed when lookup throws', async () => {
    const out = await resolveAndCheck('nope.example', {
      lookup: async () => {
        throw new Error('NXDOMAIN');
      },
    });
    expect(out).toEqual({ ok: false, reason: 'resolve_failed' });
  });

  it('skips check when disabled', async () => {
    const lookup = vi.fn();
    const out = await resolveAndCheck('rebind.example', { lookup, enabled: false });
    expect(out).toEqual({ ok: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('strips brackets from IPv6 hostname literal', async () => {
    const out = await resolveAndCheck('[::1]');
    expect(out).toEqual({ ok: false, reason: 'private' });
  });
});
