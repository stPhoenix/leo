export type FailureCode =
  | 'infra_error'
  | 'partial'
  | 'circuit_breaker'
  | 'generic_error'
  | 'unknown_failure';

export interface DecodedFailure {
  readonly code: FailureCode;
  readonly message: string;
}

const PREFIXES: ReadonlyArray<{ prefix: string; code: FailureCode }> = [
  { prefix: 'INFRA_ERROR:', code: 'infra_error' },
  { prefix: 'PARTIAL:', code: 'partial' },
  { prefix: 'CIRCUIT_BREAKER:', code: 'circuit_breaker' },
  { prefix: 'Error:', code: 'generic_error' },
];

export function decodeFailureText(text: string): DecodedFailure {
  const trimmed = (text ?? '').trimStart();
  for (const { prefix, code } of PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const body = trimmed.slice(prefix.length).trimStart();
      return { code, message: body };
    }
  }
  return { code: 'unknown_failure', message: text ?? '' };
}
