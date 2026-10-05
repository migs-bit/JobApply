import { LIMITS } from '../../shared/constants';
import type { FieldCandidate } from '../../shared/types';
import { collapse, isShown, nearbyText, resolveLabel, type FormControl } from './field-text';
import { groupRadios, radioGroupLabel, radioOptionLabel } from './radio-group';
import { hashId, uniqueSelector } from './selector';

/**
 * Generic DOM scanner: finds form fields in the top-level document and
 * describes them as FieldCandidates. No site-specific logic.
 *
 * Radios sharing a name are reported as ONE field per group (see radio-group.ts).
 *
 * MVP limits: iframes and shadow DOM are not scanned.
 *
 * Privacy: never reads a field's value. Pages often prefill fields with data
 * about the signed-in user, and nothing downstream needs it.
 */

export type SkipReason = 'non-fillable type' | 'disabled' | 'readonly' | 'not rendered';

export interface SkippedField {
  tag: string;
  type: string;
  name: string;
  reason: SkipReason;
}

export interface ScanResult {
  fields: FieldCandidate[];
  /** Why each ignored control was ignored; this is the first thing to check when a field is "missing". */
  skipped: SkippedField[];
  /** True if the page had more than LIMITS.fieldsPerPage fields and the rest were dropped. */
  truncated: boolean;
}

// `image` isn't in the brief's list, but it's a graphical submit button.
const NON_FILLABLE_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export function scanFields(doc: Document = document): ScanResult {
  const controls = Array.from(doc.querySelectorAll<FormControl>('input, textarea, select'));

  const scannable: FormControl[] = [];
  const skipped: SkippedField[] = [];
  for (const el of controls) {
    const reason = skipReason(el);
    if (reason) skipped.push({ tag: el.localName, type: typeOf(el), name: el.name, reason });
    else scannable.push(el);
  }

  const truncated = scannable.length > LIMITS.fieldsPerPage;
  const kept = scannable.slice(0, LIMITS.fieldsPerPage);
  const scannableSet: ReadonlySet<Element> = new Set(kept);
  const usedIds = new Set<string>();

  // Each radio group is reported once, at the position of its first radio.
  const isRadio = (el: FormControl): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio';
  const groupOf = new Map<HTMLInputElement, HTMLInputElement[]>();
  for (const group of groupRadios(kept.filter(isRadio))) {
    if (group[0]) groupOf.set(group[0], group);
  }

  const fields: FieldCandidate[] = [];
  for (const el of kept) {
    if (isRadio(el) && !groupOf.has(el)) continue; // a later radio of a group already reported
    const selector = uniqueSelector(el);
    const base = {
      id: uniqueId(hashId(selector), usedIds),
      selector,
      tag: el.localName as FieldCandidate['tag'],
      type: typeOf(el),
      name: attr(el, 'name'),
      autocomplete: attr(el, 'autocomplete'),
      placeholder: attr(el, 'placeholder'),
      nearbyText: nearbyText(el, scannableSet),
    };
    const group = isRadio(el) ? groupOf.get(el) : undefined;
    if (group) {
      // The question is the group's label or nearby text; each radio's own label is an option, never the question.
      fields.push({ ...base, ...radioGroupLabel(group), options: group.slice(0, LIMITS.optionsPerField).map(radioOptionLabel) });
    } else {
      fields.push({ ...base, label: resolveLabel(el), ariaLabel: attr(el, 'aria-label') });
    }
  }

  return { fields, skipped, truncated };
}

function skipReason(el: FormControl): SkipReason | null {
  if (el instanceof HTMLInputElement && NON_FILLABLE_TYPES.has(el.type)) return 'non-fillable type';
  // :disabled also covers controls inside a <fieldset disabled>.
  if (el.matches(':disabled')) return 'disabled';
  if (!(el instanceof HTMLSelectElement) && el.readOnly) return 'readonly';
  // Opacity-0 and visually-hidden fields are deliberately kept: custom-styled
  // inputs often hide the native control that still holds the form value.
  if (!isShown(el)) return 'not rendered';
  return null;
}

/** Input `type` as the browser normalizes it ("TEXT" → "text", unknown → "text"); empty for textarea/select. */
function typeOf(el: FormControl): string {
  return el instanceof HTMLInputElement ? el.type : '';
}

function attr(el: Element, name: string): string {
  return collapse(el.getAttribute(name) ?? '').slice(0, LIMITS.fieldTextLength);
}

/** Selectors are unique, so hash collisions are near-impossible; still, never emit a duplicate id. */
function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  used.add(id);
  return id;
}
