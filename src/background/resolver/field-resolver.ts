import type { FieldCandidate, Profile, ResolvedField } from '../../shared/types';
import { EMPTY_LEARNED, type LearnedStore } from '../storage/learned-store';
import { unfillableReason } from './field-rules';
import { tierAutocomplete } from './tier-autocomplete';
import { tierDictionary } from './tier-dictionary';
import { tierFuzzy } from './tier-fuzzy';
import { tierLearned } from './tier-learned';

/**
 * Tiered field resolver. Each tier is a pure function; the first one that
 * returns a match wins. Tiers are numbered by run order:
 *
 *   1 autocomplete   the page's own autocomplete hint
 *   2 dictionary     word patterns on label / name / question text
 *   3 learned        answers the user taught for this exact question
 *   4 fuzzy          word overlap with synonym phrases (a capped-confidence guess)
 *   5 site adapters  (planned)
 *   6 AI fallback    (planned, the user's own key only)
 *
 * Runs in the service worker so the future AI tier (which needs network
 * access) is a one-file addition here.
 */
export type Tier = (field: FieldCandidate, profile: Profile, learned: LearnedStore) => ResolvedField | null;

const TIERS: readonly Tier[] = [
  tierAutocomplete, // 1
  tierDictionary, // 2
  (field, _profile, learned) => tierLearned(field, learned), // 3
  tierFuzzy, // 4
];

export function resolveField(field: FieldCandidate, profile: Profile, learned: LearnedStore = EMPTY_LEARNED): ResolvedField {
  const outOfScope = unfillableReason(field);
  if (outOfScope) return unknown(field, outOfScope);

  for (const tier of TIERS) {
    const match = tier(field, profile, learned);
    if (!match) continue;
    // A file input takes the resume or nothing: never a learned text answer or a profile value.
    if (field.type === 'file' && match.key !== 'resume') return unknown(field, 'file inputs only take your resume');
    return match;
  }
  return unknown(field, field.type === 'file' ? 'not a resume field' : 'no tier matched');
}

export function resolveFields(fields: readonly FieldCandidate[], profile: Profile, learned: LearnedStore = EMPTY_LEARNED): ResolvedField[] {
  return fields.map((field) => resolveField(field, profile, learned));
}

function unknown(field: FieldCandidate, evidence: string): ResolvedField {
  return { fieldId: field.id, key: 'unknown', confidence: 0, source: 'none', evidence };
}
