import { choiceFor } from '../shared/choices';
import { ALWAYS_REVIEW_KEYS, REVIEW_THRESHOLD } from '../shared/constants';
import { normalizeQuestion, questionTextOf } from '../shared/question';
import type { FieldCandidate, FillInstruction, FillPlan, Profile, ResolvableKey, ResumeFile } from '../shared/types';
import { resolveFields } from './resolver/field-resolver';
import { EMPTY_LEARNED, learnedOptionsFor, type LearnedStore } from './storage/learned-store';

/**
 * Turns scanned fields into a fill plan: resolve every field, then attach
 * values only where there's something to fill. Pure, so it's unit tested
 * directly. Values come from the profile, or for 'learned' fields from the
 * user's taught answers (case 1). Learned option wordings (case 2) ride along
 * as `learnedOptions`, limited to the user's saved answer for that key.
 *
 * Resume fields always get an instruction (value: the filename, or '' when
 * none is uploaded, so the filler can report "no resume uploaded"). The file
 * itself is attached to the plan once, and only if some field needs it.
 */
export function buildFillPlan(
  fields: readonly FieldCandidate[],
  profile: Profile,
  learned: LearnedStore = EMPTY_LEARNED,
  resume: ResumeFile | null = null,
): FillPlan {
  const resolutions = resolveFields(fields, profile, learned);
  const byId = new Map(fields.map((f) => [f.id, f]));

  const instructions: FillPlan['instructions'] = [];
  for (const r of resolutions) {
    const field = byId.get(r.fieldId);
    if (r.key === 'unknown' || !field) continue;
    const base = { fieldId: r.fieldId, selector: field.selector, confidence: r.confidence, source: r.source };

    if (r.key === 'learned') {
      // Case 1: a taught answer. Typed into text fields as-is; for dropdowns and radios it's the option to pick.
      const taught = learned.answers[normalizeQuestion(questionTextOf(field))];
      if (!taught) continue;
      // Typed answers can be stale or company-specific ("Why do you want to work here?"), so they're always
      // reviewed. A dropdown or radio answer must exactly match one of the page's own options, so it isn't.
      const picksAnOption = field.tag === 'select' || field.type === 'radio';
      instructions.push({
        ...base,
        key: 'learned',
        value: taught.answer,
        optionCandidates: [taught.answer],
        requiresReview: !picksAnOption || r.confidence < REVIEW_THRESHOLD,
      });
      continue;
    }

    if (r.key === 'resume') {
      // A file upload is always shown for review, however sure the match.
      instructions.push({ ...base, key: 'resume', value: resume?.filename ?? '', requiresReview: true });
      continue;
    }

    const saved = profileValue(r.key, profile);
    if (!saved) continue; // nothing saved for this key: send nothing

    // A choice code becomes its label (for text boxes) plus the option texts
    // that mean it (for dropdowns, whose wording varies by form).
    const choice = choiceFor(r.key, saved);
    const taughtOptions = choice ? learnedOptionsFor(learned, r.key as keyof Profile, saved) : [];
    const instruction: FillInstruction = {
      ...base,
      key: r.key,
      value: choice ? choice.label : saved,
      ...(choice ? { optionCandidates: choice.synonyms } : {}),
      ...(taughtOptions.length ? { learnedOptions: taughtOptions } : {}),
      // Sensitive answers (EEO, work eligibility, salary) always get a human look.
      requiresReview: r.confidence < REVIEW_THRESHOLD || (ALWAYS_REVIEW_KEYS as ReadonlySet<string>).has(r.key),
    };
    instructions.push(instruction);
  }
  const needsResume = resume !== null && instructions.some((i) => i.key === 'resume');
  return { resolutions, instructions, ...(needsResume ? { resume } : {}) };
}

/** The value to fill for a key; empty string means "don't fill". */
export function profileValue(key: ResolvableKey, profile: Profile): string {
  if (key === 'resume') return ''; // a file, not a profile value (see above)
  if (key === 'fullName') {
    // A lone first name in a "Full name" field reads as a mistake, so require both.
    return profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : '';
  }
  return profile[key];
}
