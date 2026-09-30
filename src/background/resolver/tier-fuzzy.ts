import { CONFIDENCE } from '../../shared/constants';
import type { FieldCandidate, Profile, ResolvableKey, ResolvedField } from '../../shared/types';
import { FUZZY_SYNONYMS, KEY_EXCLUSIONS, NEGATIVE_CONTEXT } from './dictionary';
import { canResolve, isCompatible } from './field-rules';
import { normalizeForMatching } from './tier-dictionary';

/**
 * Tier 3: token-set (Jaccard) similarity between the field's text and each
 * key's synonym phrases. Only reached when Tiers 1 and 2 found nothing.
 *
 * Deliberately conservative:
 * - similarity below CONFIDENCE.fuzzyMinimum → no match (the field stays "unknown");
 * - confidence = similarity × CONFIDENCE.fuzzyMaximum (at most 0.6), so every
 *   fuzzy fill falls below REVIEW_THRESHOLD and gets flagged for review;
 * - a tie between two different keys is ambiguous → no match.
 *
 * Sources are scored one at a time (label, aria-label, name, placeholder) rather
 * than pooled, so a noisy `name` like "cards[3f9c…][field0]" can't dilute a
 * clean label. Nearby text isn't used: it's question prose, not a field name.
 */

/** Words that carry no field meaning ("What should we call you?" → {call}). */
const STOPWORDS = new Set(
  (
    'a an the is are be do does did will would should could can may might what which who whom whose how when where why ' +
    'we us our you your yours i me my to of for on in at by with from and or as this that it its ' +
    'please enter provide type here best like want let know tell'
  ).split(' '),
);

/** Lowercase words, no stopwords, no tokens containing digits (ids, uuids), plural "s" folded. */
export function fuzzyTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of normalizeForMatching(text).split(/[^a-z0-9]+/)) {
    if (!word || STOPWORDS.has(word) || /\d/.test(word)) continue;
    tokens.add(word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
  }
  return tokens;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

// Tokenize the synonym table once, at load.
const SYNONYM_TOKENS = FUZZY_SYNONYMS.map(
  ([key, phrases]) => [key, phrases.map((phrase) => ({ phrase, tokens: fuzzyTokens(phrase) }))] as const,
);

interface Best {
  key: ResolvableKey;
  score: number;
  phrase: string;
  what: string;
  raw: string;
}

export function tierFuzzy(field: FieldCandidate, profile: Profile): ResolvedField | null {
  const sources: Array<readonly [string, string]> = [
    ['label', field.label],
    ['aria-label', field.ariaLabel],
    ['name', field.name],
    ['placeholder', field.placeholder],
  ];

  let best: Best | null = null;
  let tied = false;
  for (const [what, raw] of sources) {
    const normalized = normalizeForMatching(raw);
    if (!raw || NEGATIVE_CONTEXT.test(normalized)) continue;
    const tokens = fuzzyTokens(raw);
    if (tokens.size === 0) continue;

    for (const [key, phrases] of SYNONYM_TOKENS) {
      if (KEY_EXCLUSIONS[key]?.test(normalized) || !isCompatible(field, key) || !canResolve(profile, key)) continue;
      for (const { phrase, tokens: phraseTokens } of phrases) {
        const score = jaccard(tokens, phraseTokens);
        if (!best || score > best.score) {
          best = { key, score, phrase, what, raw };
          tied = false;
        } else if (score === best.score && key !== best.key) {
          tied = true;
        }
      }
    }
  }

  if (!best || tied || best.score < CONFIDENCE.fuzzyMinimum) return null;
  return {
    fieldId: field.id,
    key: best.key,
    confidence: Math.round(best.score * CONFIDENCE.fuzzyMaximum * 100) / 100,
    source: 'fuzzy',
    evidence: `${best.what} "${best.raw.slice(0, 60)}" fuzzy-matched "${best.phrase}" → ${best.key} (score ${best.score.toFixed(2)})`,
  };
}
