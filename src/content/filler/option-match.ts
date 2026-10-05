import { normalizeOptionText } from '../../shared/choices';

/**
 * Picks the <option> for a dropdown. Pure (no DOM), so it's unit tested
 * directly. Candidates are tried in order:
 *
 * - the first candidate that equals exactly one option wins;
 * - a candidate that equals several options is ambiguous → no selection;
 * - nothing equal → no selection.
 *
 * "Equal" means whole-string equality after normalizeOptionText, against the
 * option's visible text or its value. Never a substring match, so "male" can't
 * pick "female".
 */
export interface OptionLike {
  text: string;
  value: string;
  disabled?: boolean;
}

export type OptionMatch = { index: number; matched: string } | { reason: 'multiple matches' | 'no option matched' };

export function matchOption(options: readonly OptionLike[], candidates: readonly string[]): OptionMatch {
  const normalized = options.map((o) => ({ text: normalizeOptionText(o.text), value: normalizeOptionText(o.value) }));

  for (const candidate of candidates) {
    const target = normalizeOptionText(candidate);
    if (!target) continue;
    const hits: number[] = [];
    normalized.forEach((o, i) => {
      if (!options[i]?.disabled && (o.text === target || o.value === target)) hits.push(i);
    });
    if (hits.length > 1) return { reason: 'multiple matches' };
    const [index] = hits;
    if (index !== undefined) return { index, matched: options[index]?.text.trim() ?? '' };
  }
  return { reason: 'no option matched' };
}

export type ChoiceMatch = { index: number; matched: string; viaLearned: boolean } | { reason: 'multiple matches' | 'no option matched' };

/**
 * Case 2 of learned-store.ts: the built-in synonyms first; only if they find
 * nothing (or are ambiguous) are the option wordings the user taught tried.
 * Same whole-string rules for both.
 */
export function matchChoice(options: readonly OptionLike[], builtIn: readonly string[], learned: readonly string[] = []): ChoiceMatch {
  const first = matchOption(options, builtIn);
  if (!('reason' in first)) return { ...first, viaLearned: false };
  if (learned.length === 0) return first;
  const taught = matchOption(options, learned);
  return 'reason' in taught ? first : { ...taught, viaLearned: true };
}

/** Visible option texts for diagnostics: the first `max`, each capped at 80 chars. */
export function optionTexts(options: readonly OptionLike[], max = 10): string[] {
  return options.slice(0, max).map((o) => o.text.replace(/\s+/g, ' ').trim().slice(0, 80));
}
