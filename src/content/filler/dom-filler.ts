import type { FillInstruction, FillResult } from '../../shared/types';
import { makeResult, querySafely } from './fill-result';
import { matchChoice, optionTexts } from './option-match';
import { isRadio, RADIO_SETTLE_MS, startRadioFill, undoRadio } from './radio-filler';
import { isVisibleToUser } from './visibility';

/**
 * Writes profile values into the page: text fields and dropdowns here, radio
 * groups in radio-filler.ts.
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

/**
 * Applies every instruction. Radio groups are clicked first and verified
 * together after one short settle, so ten groups cost one wait, not ten.
 */
export async function applyFill(instructions: readonly FillInstruction[], doc: Document = document): Promise<FillResult[]> {
  const pending = instructions.map((instruction) =>
    isRadio(querySafely(doc, instruction.selector)) ? startRadioFill(instruction, doc) : fillOne(instruction, doc),
  );
  if (pending.some((p) => typeof p === 'function')) await new Promise((r) => setTimeout(r, RADIO_SETTLE_MS));
  return pending.map((p) => (typeof p === 'function' ? p() : p));
}

function fillOne(instruction: FillInstruction, doc: Document): FillResult {
  const el = querySafely(doc, instruction.selector);
  // Dropdown diagnostics, attached to every result once we know the element is a <select>.
  const choice: FillResult['choice'] =
    el instanceof HTMLSelectElement ? { matched: null, options: optionTexts(Array.from(el.options)) } : undefined;
  const result = (status: FillResult['status'], previousValue: string, reason?: string) =>
    makeResult(instruction, status, previousValue, reason, choice);

  if (!el) return result('skipped', '', 'element not found');
  if (!isFillable(el)) return result('skipped', '', 'element is not a fillable text field');
  if (el.matches(':disabled') || (!(el instanceof HTMLSelectElement) && el.readOnly)) {
    return result('skipped', '', 'disabled or read-only');
  }
  // Security: only fill what the user can see (see visibility.ts).
  if (!isVisibleToUser(el)) return result('skipped', '', 'not visible');

  const previousValue = el.value;
  if (previousValue.trim() !== '') return result('skipped', previousValue, 'already has a value');

  let value = instruction.value;
  if (el instanceof HTMLSelectElement) {
    const options = Array.from(el.options);
    const match = matchChoice(options, instruction.optionCandidates ?? [instruction.value], instruction.learnedOptions);
    if ('reason' in match) return result('skipped', previousValue, match.reason);
    if (choice) Object.assign(choice, { matched: match.matched, ...(match.viaLearned ? { viaLearned: true } : {}) });
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

export interface UndoOutcome {
  restored: number;
  /** Selectors of radio groups whose answer had to stay (see undoRadio): the user changes these on the page. */
  manual: string[];
}

/**
 * Restores fields this extension filled to their previous values. Only undoes
 * our own writes: a field (or radio group) the user has changed since filling
 * is left alone.
 */
export function undoFill(results: readonly FillResult[], doc: Document = document): UndoOutcome {
  let restored = 0;
  const manual: string[] = [];
  for (const r of results) {
    if (r.status !== 'filled') continue;
    const el = querySafely(doc, r.selector);
    if (isRadio(el)) {
      const outcome = undoRadio(r, doc);
      if (outcome === 'restored') restored++;
      if (outcome === 'manual') manual.push(r.selector);
      continue;
    }
    const record = el ? applied.get(el) : undefined;
    if (!el || !record || !isFillable(el) || el.value !== record.filled) continue;
    setNativeValue(el, record.previous);
    applied.delete(el);
    restored++;
  }
  return { restored, manual };
}

function isFillable(el: Element): el is Fillable {
  if (el instanceof HTMLInputElement) return FILLABLE_INPUT_TYPES.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}
