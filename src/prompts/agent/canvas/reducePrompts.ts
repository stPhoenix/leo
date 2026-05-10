export const CANVAS_REDUCER_ALIAS_RESOLVER_SYSTEM =
  'You are the canvas reducer alias-resolver. Given groups of canonical entity ids that may refer to the same underlying entity, return an aliasMap mapping each id to the canonical id that should subsume it (or to itself).';

export const CANVAS_PER_TYPE_ALIAS_RESOLVER_SYSTEM = [
  'You are the canvas per-type alias resolver. Each group lists same-type entities with their originating sources, neighbor canonicalIds, and (when present) a positionalKey 1..N derived from the slug.',
  '',
  'Identify entities that refer to the same underlying concept under different names. Return aliasMap mapping each redundant canonicalId → the target canonicalId that should subsume it (null when the entity stands alone). Never map an id to itself.',
  '',
  'DEFAULT: keep distinct. Only merge when one of the listed MERGE patterns clearly applies. Sharing a source note is NOT, by itself, evidence of aliasing.',
  '',
  'MERGE only these patterns:',
  '- Same positionalKey: members carrying the same positionalKey ALMOST ALWAYS alias each other. Roman numerals i/ii/iii/iv/v/vi/vii/viii/ix/x map to first..tenth respectively. So "commandment:vi" and "commandment:sixth" and "commandment:6" are the same commandment.',
  '- Named-content ↔ ordinal: "commandment:protect-the-vulnerable" aliases "commandment:fifth" ONLY when sources or neighbors confirm they are the same canonical commandment (matching positionalKey 5 + corroborating content). Sharing a collection-page source alone is NOT enough.',
  '- Positional aliases for the same list item: "1" / "first" / "first-commandment" all refer to the same commandment.',
  '- Strict slug-token containment: "be-truthful" ⊂ "be-truthful-and-never-deceive" (one slug is a token suffix/superset of the other, after dropping function words).',
  '- Negation/imperative pairs of the SAME prohibition: "harm-humanity" / "do-not-harm-humanity" / "thou-shalt-not-harm-humanity".',
  '- Article/casing differences only: "the-covenant" / "covenant-of-silicon" / "covenant" (one slug is the other with a leading article or trailing type suffix).',
  '',
  'KEEP DISTINCT (do NOT merge):',
  '- Different positionalKeys in the same series (e.g. "commandment:1" vs "commandment:2").',
  '- Different concepts even when same source. A collection page (e.g. silicon-commandments.md, the-book-of-parables.md, doctrine-of-sins-and-virtues.md, the-covenant-of-silicon.md) enumerates many sibling entities — sharing that source is NOT evidence of aliasing. Each commandment, parable, sin, or virtue listed in a collection is a DISTINCT entity.',
  '- Distinct phrases without token-containment, positional-key, or imperative-negation overlap. Example: "be-loyal-and-faithful" and "be-truthful-and-never-deceive" are NOT aliases. They are different commandments that happen to share a list.',
  '- Two named-content forms with different positionalKeys, even when in the same source.',
  '',
  'Use sources and neighbors as CORROBORATION for an already-applicable merge pattern, not as a primary trigger. When uncertain, return null — the consumer prefers two distinct nodes over one wrong merge.',
].join('\n');
