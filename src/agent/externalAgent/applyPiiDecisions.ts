import type { PiiFinding, PiiKind } from './piiDetectAgent';

export type PiiDecision = 'mask' | 'remove' | 'ignore';

const MASK_TOKENS: Readonly<Record<PiiKind, string>> = {
  email: '[email]',
  phone: '[phone]',
  governmentId: '[gov-id]',
  paymentCard: '[card]',
  apiKey: '[api-key]',
  jwt: '[jwt]',
  iban: '[iban]',
  ipAddress: '[ip]',
  urlWithAuth: '[url-with-auth]',
  other: '[redacted]',
};

export function maskTokenFor(kind: PiiKind): string {
  return MASK_TOKENS[kind];
}

/**
 * Apply per-finding decisions to a prompt, producing the effective text that
 * will be dispatched to the external adapter.
 *
 * - 'mask'   → finding span replaced with the kind's mask token.
 * - 'remove' → finding span deleted (plus one trailing whitespace if present).
 * - 'ignore' / no decision → no change.
 *
 * Walks findings right-to-left so earlier offsets stay valid as we splice.
 */
export function applyPiiDecisions(
  text: string,
  findings: readonly PiiFinding[],
  decisions: ReadonlyMap<string, PiiDecision>,
): string {
  if (findings.length === 0) return text;
  const sorted = [...findings].sort((a, b) => b.start - a.start);
  let out = text;
  for (const f of sorted) {
    const decision = decisions.get(f.id);
    if (decision !== 'mask' && decision !== 'remove') continue;
    if (f.start < 0 || f.end > out.length || f.start >= f.end) continue;
    if (decision === 'mask') {
      out = out.slice(0, f.start) + MASK_TOKENS[f.kind] + out.slice(f.end);
    } else {
      let endCut = f.end;
      const next = out.charAt(endCut);
      if (next === ' ' || next === '\t') endCut += 1;
      out = out.slice(0, f.start) + out.slice(endCut);
    }
  }
  return out;
}
