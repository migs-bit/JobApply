import { CONFIDENCE } from '../../shared/constants';
import type { FieldCandidate, Profile, ResolvedField } from '../../shared/types';
import { FIELD_PATTERNS, NEGATIVE_CONTEXT } from './dictionary';
import { canResolve, isCompatible } from './field-rules';

/**
 * Tier 2: regex dictionary over the field's text.
 *
 * Strong sources (label, aria-label, name) → 0.9; weak sources (placeholder,
 * nearby text) → 0.7, which is below REVIEW_THRESHOLD, so those fills get
 * flagged. Sources are tried in order and the first hit wins, so the label
 * outranks a misleading `name` attribute.
 */

type Source = readonly [what: string, text: string, confidence: number];

/**
 * Weak text longer than this reads as a question or instructions, not a
 * field label: "Please state your salary expectations" should not match
 * `state`. Short text ("City", "e.g. Toronto") still counts.
 */
const MAX_WEAK_TEXT_LENGTH = 40;

export function tierDictionary(field: FieldCandidate, profile: Profile): ResolvedField | null {
  const sources: Source[] = [
    ['label', field.label, CONFIDENCE.dictionaryStrong],
    ['aria-label', field.ariaLabel, CONFIDENCE.dictionaryStrong],
    ['name', field.name, CONFIDENCE.dictionaryStrong],
    ['placeholder', field.placeholder, CONFIDENCE.dictionaryWeak],
    ['nearby text', field.nearbyText, CONFIDENCE.dictionaryWeak],
  ];

  for (const [what, raw, confidence] of sources) {
    const text = normalizeForMatching(raw);
    if (!text || NEGATIVE_CONTEXT.test(text)) continue;
    if (confidence < CONFIDENCE.dictionaryStrong && text.length > MAX_WEAK_TEXT_LENGTH) continue;

    for (const [key, patterns] of FIELD_PATTERNS) {
      const pattern = patterns.find((p) => p.test(text));
      if (!pattern || !isCompatible(field, key) || !canResolve(profile, key)) continue;
      return {
        fieldId: field.id,
        key,
        confidence,
        source: 'dictionary',
        evidence: `${what} "${raw.slice(0, 60)}" matched ${String(pattern)}`,
      };
    }
  }
  return null;
}

/**
 * Makes names, labels, and ids comparable: "First_Name ✱" and "firstName"
 * both become "first name"; "urls[LinkedIn]" becomes "urls linked in".
 */
export function normalizeForMatching(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\((required|optional)\)|\b(required|optional)$/g, ' ')
    .replace(/[_\-.[\]():*✱]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
