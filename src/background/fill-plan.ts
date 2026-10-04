import { choiceFor } from '../shared/choices';
import { ALWAYS_REVIEW_KEYS, REVIEW_THRESHOLD } from '../shared/constants';
import type { FieldCandidate, FillPlan, Profile, ResolvableKey } from '../shared/types';
import { resolveFields } from './resolver/field-resolver';

/**
 * Turns scanned fields into a fill plan: resolve every field, then attach
 * profile values only where there's something to fill. Pure, so it's unit
 * tested directly.
 */
export function buildFillPlan(fields: readonly FieldCandidate[], profile: Profile): FillPlan {
  const resolutions = resolveFields(fields, profile);
  const byId = new Map(fields.map((f) => [f.id, f]));

  const instructions: FillPlan['instructions'] = [];
  for (const r of resolutions) {
    const field = byId.get(r.fieldId);
    if (r.key === 'unknown' || !field) continue;
    const saved = profileValue(r.key, profile);
    if (!saved) continue; // nothing saved for this key: send nothing

    // A choice code becomes its label (for text boxes) plus the option texts
    // that mean it (for dropdowns, whose wording varies by form).
    const choice = choiceFor(r.key, saved);
    instructions.push({
      fieldId: r.fieldId,
      key: r.key,
      selector: field.selector,
      value: choice ? choice.label : saved,
      ...(choice ? { optionCandidates: choice.synonyms } : {}),
      confidence: r.confidence,
      source: r.source,
      // Sensitive answers (EEO, work eligibility, salary) always get a human look.
      requiresReview: r.confidence < REVIEW_THRESHOLD || (ALWAYS_REVIEW_KEYS as ReadonlySet<string>).has(r.key),
    });
  }
  return { resolutions, instructions };
}

/** The value to fill for a key; empty string means "don't fill". */
export function profileValue(key: ResolvableKey, profile: Profile): string {
  if (key === 'fullName') {
    // A lone first name in a "Full name" field reads as a mistake, so require both.
    return profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : '';
  }
  return profile[key];
}
