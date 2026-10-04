import type { FillInstruction, FillResult } from '../../shared/types';
import { matchOption, optionTexts } from './option-match';

/**
 * Writes profile values into the page.
 *
 * Every target is re-checked at fill time, not trusted from the scan: the
 * page can change between scanning and filling (the service-worker round
 * trip is async), and a selector that pointed at a text box could now point
 * at a password field or a hidden one.
 */

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const FILLABLE_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search']);

/**
 * What each successful fill wrote and what it replaced, for Undo. Kept in the
 * content script's isolated world (never logged, never sent anywhere), and
 * weakly keyed so a field the page removes doesn't linger.
 */
const applied = new WeakMap<Element, { filled: string; previous: string }>();

/**
 * React-safe value setter (Brief.md). Frameworks like React wrap an input's
 * `value` setter to track changes; assigning through that wrapper makes React
 * think nothing changed and it discards the input event. Calling the native
 * prototype setter bypasses the wrapper, so the events below look like real
 * user input. (Content scripts run in an isolated world where the page's
 * wrapper isn't visible anyway; using the prototype setter keeps this correct
 * in either world.)
 */
export function setNativeValue(el: Fillable, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function applyFill(instructions: readonly FillInstruction[], doc: Document = document): FillResult[] {
  return instructions.map((instruction) => fillOne(instruction, doc));
}

function fillOne(instruction: FillInstruction, doc: Document): FillResult {
  const { fieldId, key, selector, confidence, source, requiresReview } = instruction;
  // Dropdown diagnostics, attached to every result once we know the element is a <select>.
  let select: FillResult['select'];
  const result = (status: FillResult['status'], previousValue: string, reason?: string): FillResult => ({
    fieldId,
    key,
    selector,
    status,
    ...(reason ? { reason } : {}),
    confidence,
    source,
    requiresReview,
    previousValue,
    ...(select ? { select } : {}),
  });

  const el = querySafely(doc, selector);
  if (el instanceof HTMLSelectElement) select = { matched: null, options: optionTexts(Array.from(el.options)) };
  if (!el) return result('skipped', '', 'element not found');
  if (!isFillable(el)) return result('skipped', '', 'element is not a fillable text field');
  if (el.matches(':disabled') || (!(el instanceof HTMLSelectElement) && el.readOnly)) {
    return result('skipped', '', 'disabled or read-only');
  }
  // Security: only fill what the user can see. Hidden, transparent, tiny, or
  // off-screen fields are a known autofill-phishing trick for harvesting
  // data the user never sees being filled.
  if (!isVisibleToUser(el)) return result('skipped', '', 'not visible');

  const previousValue = el.value;
  if (previousValue.trim() !== '') return result('skipped', previousValue, 'already has a value');

  let value = instruction.value;
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const match = matchOption(options, instruction.optionCandidates ?? [instruction.value]);
    if ('reason' in match) return result('skipped', previousValue, match.reason);
    if (select) select.matched = match.matched;
    value = options[match.index]?.value ?? '';
  } else if (el.maxLength >= 0 && value.length > el.maxLength) {
    // Truncating would silently submit wrong data (a cut-off email, a partial URL).
    return result('skipped', previousValue, 'value longer than the field allows');
  }

  setNativeValue(el, value);
  // A controlled input with no change handler, or a script that clears the
  // field, leaves it empty; report that instead of claiming success.
  if (el.value === '') return result('failed', previousValue, 'page did not keep the value');
  applied.set(el, { filled: el.value, previous: previousValue });
  return result('filled', previousValue);
}

/**
 * Restores fields this extension filled to their previous values. Only undoes
 * our own writes: a field the user has edited since filling is left alone.
 * Returns how many fields were restored.
 */
export function undoFill(results: readonly FillResult[], doc: Document = document): number {
  let restored = 0;
  for (const r of results) {
    if (r.status !== 'filled') continue;
    const el = querySafely(doc, r.selector);
    const record = el ? applied.get(el) : undefined;
    if (!el || !record || !isFillable(el) || el.value !== record.filled) continue;
    setNativeValue(el, record.previous);
    applied.delete(el);
    restored++;
  }
  return restored;
}

function querySafely(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null; // malformed selector
  }
}

function isFillable(el: Element): el is Fillable {
  if (el instanceof HTMLInputElement) return FILLABLE_INPUT_TYPES.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

const MIN_VISIBLE_PX = 4;

/**
 * Stricter than the scanner's check (which keeps opacity-0 controls so they
 * show up in diagnostics). A field counts as visible only if:
 * - it and its ancestors aren't display:none, visibility:hidden, or opacity 0;
 * - its *visible* area, after clipping by `clip`, `clip-path`, and every
 *   overflow-clipping ancestor, is at least MIN_VISIBLE_PX on each side.
 *   This catches the "screen-reader only" pattern (1px + clip), where the
 *   input's padding still gives it a normal-looking box;
 * - it isn't pushed off the page with negative positioning.
 */
function isVisibleToUser(el: Element): boolean {
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
    return false;
  }

  let { left, top, right, bottom } = el.getBoundingClientRect();
  for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (clipsToNothing(style)) return false;
    if (node !== el && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
      const box = node.getBoundingClientRect();
      left = Math.max(left, box.left);
      top = Math.max(top, box.top);
      right = Math.min(right, box.right);
      bottom = Math.min(bottom, box.bottom);
    }
  }
  if (right - left < MIN_VISIBLE_PX || bottom - top < MIN_VISIBLE_PX) return false;
  return right + window.scrollX > 0 && bottom + window.scrollY > 0;
}

/** `clip: rect(0 0 0 0)` / `clip-path: inset(50%)`: the common ways to visually hide an element. */
function clipsToNothing(style: CSSStyleDeclaration): boolean {
  const clip = /^rect\(\s*([-\d.]+)px,?\s*([-\d.]+)px,?\s*([-\d.]+)px,?\s*([-\d.]+)px\s*\)$/.exec(style.clip);
  if (clip && (style.position === 'absolute' || style.position === 'fixed')) {
    const [top, right, bottom, left] = clip.slice(1).map(Number) as [number, number, number, number];
    if (bottom - top < MIN_VISIBLE_PX || right - left < MIN_VISIBLE_PX) return true;
  }
  const inset = /^inset\(\s*([\d.]+)%/.exec(style.clipPath);
  return inset !== null && Number(inset[1]) >= 50;
}
