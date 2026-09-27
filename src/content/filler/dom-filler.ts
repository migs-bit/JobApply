import type { FillInstruction, FillResult } from '../../shared/types';
import { findFieldElement } from '../scanner/dom-scanner';

/**
 * DOM filler — writes values into fields in a way frameworks notice.
 *
 * Why not just `el.value = x`? React (and similar libraries) track an input's
 * value through an instrumented `value` setter on the element instance. If we
 * go through that setter, React records the new value as "already known" and
 * swallows the subsequent input event, so component state never updates.
 * Calling the *prototype's* native setter bypasses the tracker; the input
 * event we dispatch afterwards then looks like a real user edit.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(element) as object;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }
}

/** Sets the value and fires the events forms/validators listen for. */
function fillElement(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  el.focus({ preventScroll: true });
  setNativeValue(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur(); // triggers on-blur validation (Formik, react-hook-form, etc.)
}

/** Picks the <option> whose value or text best matches `value`. */
function matchSelectOption(el: HTMLSelectElement, value: string): string | null {
  const target = value.trim().toLowerCase();
  const opts = Array.from(el.options);
  const exact = opts.find((o) => o.value.toLowerCase() === target || o.text.trim().toLowerCase() === target);
  const partial = exact ?? opts.find((o) => target && o.text.toLowerCase().includes(target));
  return partial ? partial.value : null;
}

/** Applies each instruction to the page and reports what happened. */
export function applyFillInstructions(instructions: FillInstruction[]): FillResult[] {
  return instructions.map((instruction): FillResult => {
    const el = findFieldElement(instruction.fieldId);
    const label = el ? describeField(el) : instruction.fieldId;

    if (instruction.action === 'skip') {
      return { instruction, label, status: 'skipped', reason: instruction.reason };
    }
    if (
      !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    ) {
      return { instruction, label, status: 'failed', reason: 'Element not found' };
    }
    // Never clobber something the user (or the site) already entered.
    if (!(el instanceof HTMLSelectElement) && el.value.trim() !== '') {
      return { instruction, label, status: 'skipped', reason: 'Already has a value' };
    }

    try {
      let value = instruction.value;
      if (el instanceof HTMLSelectElement) {
        const match = matchSelectOption(el, value);
        if (match === null) return { instruction, label, status: 'skipped', reason: 'No matching option' };
        value = match;
      }
      fillElement(el, value);
      return { instruction, label, status: 'filled' };
    } catch (err) {
      return { instruction, label, status: 'failed', reason: String(err) };
    }
  });
}

/** Short human-readable name for a field, used in the overlay. */
function describeField(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const fromLabel = input.labels?.[0]?.textContent;
  const labelledBy = el.getAttribute('aria-labelledby')?.split(/\s+/)[0];
  const fromLabelledBy = labelledBy ? document.getElementById(labelledBy)?.textContent : '';
  const text =
    fromLabel ||
    fromLabelledBy ||
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('name') ||
    el.id ||
    el.tagName.toLowerCase();
  return text.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim().slice(0, 60);
}
