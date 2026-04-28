import { describe, expect, it } from 'vitest';
import {
  applyPiiDecisions,
  maskTokenFor,
  type PiiDecision,
} from '@/agent/externalAgent/applyPiiDecisions';
import type { PiiFinding } from '@/agent/externalAgent/piiDetectAgent';

function finding(
  part: Partial<PiiFinding> & Pick<PiiFinding, 'kind' | 'start' | 'end'>,
): PiiFinding {
  return {
    id: part.id ?? `${part.kind}-${part.start}-${part.end}`,
    kind: part.kind,
    start: part.start,
    end: part.end,
    sample: part.sample ?? '*',
    suggestion: part.suggestion ?? 'mask',
    ...(part.note !== undefined ? { note: part.note } : {}),
  };
}

describe('applyPiiDecisions', () => {
  it('returns text unchanged when no findings', () => {
    expect(applyPiiDecisions('hello world', [], new Map())).toBe('hello world');
  });

  it('returns text unchanged when all decisions are ignore', () => {
    const text = 'email me at jane@x.com';
    const f = finding({ kind: 'email', start: 12, end: 22 });
    const decisions = new Map<string, PiiDecision>([[f.id, 'ignore']]);
    expect(applyPiiDecisions(text, [f], decisions)).toBe(text);
  });

  it('masks email finding with [email] token', () => {
    const text = 'email me at jane@x.com';
    const f = finding({ kind: 'email', start: 12, end: 22 });
    const out = applyPiiDecisions(text, [f], new Map([[f.id, 'mask']]));
    expect(out).toBe('email me at [email]');
  });

  it('removes finding span and one trailing whitespace', () => {
    const text = 'leak sk-abc next';
    const f = finding({ kind: 'apiKey', start: 5, end: 11 });
    const out = applyPiiDecisions(text, [f], new Map([[f.id, 'remove']]));
    expect(out).toBe('leak next');
  });

  it('processes multiple findings right-to-left without offset drift', () => {
    const text = 'a@x.com / b@y.com / c@z.com';
    const f1 = finding({ kind: 'email', start: 0, end: 7 });
    const f2 = finding({ kind: 'email', start: 10, end: 17 });
    const f3 = finding({ kind: 'email', start: 20, end: 27 });
    const decisions = new Map<string, PiiDecision>([
      [f1.id, 'mask'],
      [f2.id, 'remove'],
      [f3.id, 'mask'],
    ]);
    const out = applyPiiDecisions(text, [f1, f2, f3], decisions);
    expect(out).toBe('[email] / / [email]');
  });

  it('mixes mask, remove, ignore in one pass', () => {
    const text = 'k=AKIAEXAMPLE m=jane@x.com p=+15551234567';
    const fk = finding({ kind: 'apiKey', start: 2, end: 13 });
    const fm = finding({ kind: 'email', start: 16, end: 26 });
    const fp = finding({ kind: 'phone', start: 29, end: 41 });
    const decisions = new Map<string, PiiDecision>([
      [fk.id, 'remove'],
      [fm.id, 'mask'],
      [fp.id, 'ignore'],
    ]);
    const out = applyPiiDecisions(text, [fk, fm, fp], decisions);
    expect(out).toBe('k=m=[email] p=+15551234567');
  });

  it('emits the correct mask token per kind', () => {
    expect(maskTokenFor('email')).toBe('[email]');
    expect(maskTokenFor('phone')).toBe('[phone]');
    expect(maskTokenFor('apiKey')).toBe('[api-key]');
    expect(maskTokenFor('paymentCard')).toBe('[card]');
    expect(maskTokenFor('jwt')).toBe('[jwt]');
    expect(maskTokenFor('iban')).toBe('[iban]');
    expect(maskTokenFor('ipAddress')).toBe('[ip]');
    expect(maskTokenFor('urlWithAuth')).toBe('[url-with-auth]');
    expect(maskTokenFor('governmentId')).toBe('[gov-id]');
    expect(maskTokenFor('other')).toBe('[redacted]');
  });

  it('is idempotent when applied twice on the result', () => {
    const text = 'hello jane@x.com bye';
    const f = finding({ kind: 'email', start: 6, end: 16 });
    const once = applyPiiDecisions(text, [f], new Map([[f.id, 'mask']]));
    const twice = applyPiiDecisions(once, [], new Map());
    expect(twice).toBe(once);
  });

  it('skips findings with out-of-bounds offsets', () => {
    const text = 'short';
    const f = finding({ kind: 'email', start: 0, end: 999 });
    const out = applyPiiDecisions(text, [f], new Map([[f.id, 'mask']]));
    expect(out).toBe(text);
  });
});
