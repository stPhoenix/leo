/**
 * Function words dropped during slug-token comparisons across the canvas
 * pipeline. Shared by the reducer's per-type alias detection and the
 * `resolveFiles` `definedIn` token-overlap gate.
 */
export const SLUG_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'of',
  'to',
  'for',
  'the',
  'a',
  'an',
  'and',
  'or',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
]);
