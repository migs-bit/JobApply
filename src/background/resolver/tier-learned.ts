import { CONFIDENCE } from '../../shared/constants';
import { normalizeQuestion, questionTextOf } from '../../shared/question';
import type { FieldCandidate, ResolvedField } from '../../shared/types';
import type { LearnedStore } from '../storage/learned-store';

/**
 * Tier 3: answers the user taught for this exact question (case 1 of
 * learned-store.ts). Runs after the dictionary, so a taught answer never
 * overrides an explicit profile match, and before fuzzy matching, so it beats
 * a guess.
 *
 * Only the question text is compared (normalized: case, punctuation and
 * required markers ignored). The answer itself is attached by fill-plan.ts
 * and never appears in the evidence, which dev builds log.
 */
export function tierLearned(field: FieldCandidate, learned: LearnedStore): ResolvedField | null {
  const question = questionTextOf(field);
  const key = normalizeQuestion(question);
  if (!key || !Object.hasOwn(learned.answers, key)) return null;
  return {
    fieldId: field.id,
    key: 'learned',
    confidence: CONFIDENCE.learned,
    source: 'learned',
    evidence: `learned answer for "${question.slice(0, 60)}"`,
  };
}
