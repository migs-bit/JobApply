import type { FieldCandidate, LearnedKind } from '../../shared/types';
import { radioOptionLabel } from '../scanner/radio-group';
import { querySafely } from './fill-result';
import { isRadio, radioGroupOf } from './radio-filler';
import { isRadioVisibleToUser, isVisibleToUser } from './visibility';

/**
 * "Teach this" support: which fields can be taught, and what the user answered.
 *
 * Privacy: the scanner never reads field values. This module reads exactly
 * one field's value, and only when the user clicks "Teach this" for it.
 */

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search']);

/** Text fields, textareas, dropdowns and radio groups that the user can see. Never checkboxes, files or passwords. */
export function isTeachable(field: FieldCandidate, doc: Document = document): boolean {
  const el = querySafely(doc, field.selector);
  if (isRadio(el)) return radioGroupOf(el).some(isRadioVisibleToUser);
  const kind =
    el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));
  return !!el && kind && !el.matches(':disabled') && isVisibleToUser(el);
}

/** The answer the user gave on the page, or null if they haven't answered yet. */
export function readAnswer(field: FieldCandidate, doc: Document = document): { answer: string; kind: LearnedKind } | null {
  const el = querySafely(doc, field.selector);
  if (isRadio(el)) {
    const checked = radioGroupOf(el).find((r) => r.checked);
    return checked ? { answer: radioOptionLabel(checked), kind: 'choice' } : null;
  }
  if (el instanceof HTMLSelectElement) {
    const option = el.selectedOptions[0];
    // The "Select…" placeholder (empty value) isn't an answer.
    return option && option.value !== '' ? { answer: option.text.replace(/\s+/g, ' ').trim(), kind: 'choice' } : null;
  }
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type))) {
    const value = el.value.trim();
    return value ? { answer: value, kind: 'text' } : null;
  }
  return null;
}
