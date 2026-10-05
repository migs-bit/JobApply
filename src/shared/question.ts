import { normalizeOptionText } from './choices';
import { LIMITS } from './constants';
import type { FieldCandidate } from './types';

/**
 * The question a field asks, as shown to the user: its label, then its
 * aria-label, then the question text around it (Lever-style cards), then its
 * placeholder. Used as the key for learned answers, so the content script
 * (when teaching) and the service worker (when looking up) derive it from the
 * same scanned field in the same way.
 */
export function questionTextOf(field: Pick<FieldCandidate, 'label' | 'ariaLabel' | 'nearbyText' | 'placeholder'>): string {
  return (field.label || field.ariaLabel || field.nearbyText || field.placeholder).trim().slice(0, LIMITS.fieldTextLength);
}

/**
 * The lookup key for a question: lowercase, punctuation and required markers
 * (✱ *) removed, whitespace collapsed. "Where did you hear about us? ✱" and
 * "where did you hear about us" are the same question.
 */
export function normalizeQuestion(text: string): string {
  return normalizeOptionText(text).slice(0, LIMITS.fieldTextLength);
}
