import type { FieldCandidate } from '../../shared/types';

/**
 * DOM scanner — finds fillable fields in the page and extracts the metadata
 * Jev needs to classify them.
 *
 * MVP limits: top-level document only (no iframes, no shadow DOM), and only
 * text-like inputs, textareas, and selects.
 */

/** Attribute we stamp on each scanned element so the filler can find it later. */
export const FIELD_ID_ATTR = 'data-jobapply-id';

/** Input types we treat as fillable text. `''` covers <input> with no type. */
const SUPPORTED_INPUT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search']);

const MAX_TEXT = 200;

export function scanForm(root: Document = document): FieldCandidate[] {
  const elements = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
  );

  const candidates: FieldCandidate[] = [];
  let counter = 0;

  for (const el of elements) {
    if (!isFillable(el)) continue;

    // Reuse an existing ID on re-scan so repeated runs stay stable.
    let fieldId = el.getAttribute(FIELD_ID_ATTR);
    if (!fieldId) {
      fieldId = `ja-${Date.now().toString(36)}-${counter++}`;
      el.setAttribute(FIELD_ID_ATTR, fieldId);
    }

    const tagName = el.tagName.toLowerCase() as FieldCandidate['tagName'];
    candidates.push({
      fieldId,
      tagName,
      inputType: el instanceof HTMLInputElement ? (el.getAttribute('type') ?? '').toLowerCase() : '',
      id: el.id,
      name: el.getAttribute('name') ?? '',
      label: getLabelText(el),
      placeholder: el.getAttribute('placeholder') ?? '',
      ariaLabel: el.getAttribute('aria-label') ?? '',
      autocomplete: el.getAttribute('autocomplete') ?? '',
      nearbyText: getNearbyText(el),
      required: el.required || el.getAttribute('aria-required') === 'true',
      options:
        el instanceof HTMLSelectElement
          ? Array.from(el.options, (o) => clean(o.text)).filter(Boolean)
          : undefined,
    });
  }

  return candidates;
}

/** Finds the element for a fieldId previously assigned by scanForm. */
export function findFieldElement(fieldId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${FIELD_ID_ATTR}="${CSS.escape(fieldId)}"]`);
}

// --- Helpers ----------------------------------------------------------------

function isFillable(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if (el.disabled) return false;
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly) return false;
  if (el instanceof HTMLInputElement && !SUPPORTED_INPUT_TYPES.has(el.type.toLowerCase())) return false;
  return isVisible(el);
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** Label resolution order: <label for>, aria-labelledby, wrapping <label>. */
function getLabelText(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (el.labels && el.labels.length > 0) {
    return clean(Array.from(el.labels, (l) => l.textContent ?? '').join(' '));
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (clean(text)) return clean(text);
  }

  const wrapping = el.closest('label');
  return wrapping ? clean(wrapping.textContent ?? '') : '';
}

/**
 * Grabs text from the closest ancestor that has some (but not too much) text —
 * usually the field's wrapper containing its question/heading/helper text.
 * Stops before reaching an ancestor that also wraps other fields, so we don't
 * pick up a neighbouring field's label.
 */
function getNearbyText(el: HTMLElement): string {
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    if (node.querySelectorAll('input, textarea, select').length > 1) break;
    const text = clean(node.innerText ?? '');
    if (text.length > 400) break;
    if (text) return text.slice(0, MAX_TEXT);
  }
  return '';
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim().slice(0, MAX_TEXT);
}
