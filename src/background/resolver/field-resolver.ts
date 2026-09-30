import type { FieldCandidate, Profile, ResolvedField } from '../../shared/types';
import { unfillableReason } from './field-rules';
import { tierAutocomplete } from './tier-autocomplete';
import { tierDictionary } from './tier-dictionary';

/**
 * Tiered field resolver. Each tier is a pure function; the first one that
 * returns a match wins. Runs in the service worker so the future AI tier
 * (which needs network access) is a one-file addition here.
 */
export type Tier = (field: FieldCandidate, profile: Profile) => ResolvedField | null;

const TIERS: readonly Tier[] = [
  tierAutocomplete, // Tier 1
  tierDictionary, // Tier 2
  // Tier 3 (fuzzy) is build step 10; Tiers 4-5 are post-MVP.
];

export function resolveField(field: FieldCandidate, profile: Profile): ResolvedField {
  const outOfScope = unfillableReason(field);
  if (outOfScope) return unknown(field, outOfScope);

  for (const tier of TIERS) {
    const match = tier(field, profile);
    if (match) return match;
  }
  return unknown(field, 'no tier matched');
}

export function resolveFields(fields: readonly FieldCandidate[], profile: Profile): ResolvedField[] {
  return fields.map((field) => resolveField(field, profile));
}

function unknown(field: FieldCandidate, evidence: string): ResolvedField {
  return { fieldId: field.id, key: 'unknown', confidence: 0, source: 'none', evidence };
}
