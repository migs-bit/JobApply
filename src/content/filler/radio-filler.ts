import type { FillInstruction, FillResult } from '../../shared/types';
import { radioOptionLabel } from '../scanner/radio-group';
import { makeResult, querySafely } from './fill-result';
import { matchChoice, optionTexts } from './option-match';
import { isRadioVisibleToUser } from './visibility';

/**
 * Fills a radio group: picks the radio whose label matches the answer (via
 * the choice synonyms) and CLICKS it. Setting `.checked` isn't enough:
 * React-controlled radios only update their state on a real click, and revert
 * a property change on the next render.
 *
 * The group is re-found and re-checked at fill time, like every other target.
 */

/** What a fill clicked, keyed by the group's first radio, so Undo reverts only our own click. */
const clicked = new WeakMap<HTMLInputElement, { clicked: HTMLInputElement; previous: HTMLInputElement | null }>();

/** How long to wait after clicking before checking that the page kept the selection. */
export const RADIO_SETTLE_MS = 100;

export function isRadio(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'radio';
}

/** The radios the browser links to `first`: same name, same form (or both outside any form). */
export function radioGroupOf(first: HTMLInputElement): HTMLInputElement[] {
  if (!first.name) return [first];
  return Array.from(first.ownerDocument.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
    (r) => r.name === first.name && r.form === first.form,
  );
}

/**
 * Starts filling a radio group. Returns either a final result (skipped:
 * nothing clicked) or a `settle` function to call after RADIO_SETTLE_MS, which
 * checks that the click stuck. The caller batches the wait across groups.
 */
export function startRadioFill(instruction: FillInstruction, doc: Document): FillResult | (() => FillResult) {
  const first = querySafely(doc, instruction.selector);
  if (!isRadio(first)) return makeResult(instruction, 'skipped', '', 'element is not a radio button');

  const group = radioGroupOf(first);
  const usable = group.filter((r) => !r.matches(':disabled') && isRadioVisibleToUser(r));
  // Disabled or hidden radios are listed (for diagnostics) but can't be chosen.
  const options = group.map((r) => ({ text: radioOptionLabel(r), value: r.value, disabled: !usable.includes(r) }));
  const choice: NonNullable<FillResult['choice']> = { matched: null, options: optionTexts(options) };
  const current = group.find((r) => r.checked) ?? null;
  const previousValue = current ? radioOptionLabel(current) : '';
  const skip = (reason: string) => makeResult(instruction, 'skipped', previousValue, reason, choice);

  if (usable.length === 0) return skip(group.every((r) => r.matches(':disabled')) ? 'disabled or read-only' : 'not visible');
  // Never change an answer that's already there, whoever chose it.
  if (current) return skip('already has a value');

  const match = matchChoice(options, instruction.optionCandidates ?? [instruction.value], instruction.learnedOptions);
  if ('reason' in match) return skip(match.reason);
  const target = group[match.index];
  if (!target) return skip('no option matched');
  choice.matched = match.matched;
  if (match.viaLearned) choice.viaLearned = true;

  target.click();
  return () => {
    // A page can cancel the click or restore its own state on re-render.
    if (!target.checked) return makeResult(instruction, 'failed', previousValue, 'page reverted', choice);
    clicked.set(first, { clicked: target, previous: current });
    return makeResult(instruction, 'filled', previousValue, undefined, choice);
  };
}

/**
 * Undoes our click on one group:
 * - 'restored': the radio selected before was clicked again (a real click, so
 *   React state follows);
 * - 'manual': nothing was selected before. No user action can un-select a
 *   radio, so frameworks like React never hear about a programmatic clear:
 *   the page would show an empty question while the form still submits our
 *   answer. Rather than create that invisible mismatch, the answer is left in
 *   place and the user is told to change it on the page;
 * - 'skipped': not ours to undo (the user changed the answer since).
 */
export function undoRadio(result: FillResult, doc: Document): 'restored' | 'manual' | 'skipped' {
  const first = querySafely(doc, result.selector);
  const record = isRadio(first) ? clicked.get(first) : undefined;
  if (!first || !record || !record.clicked.checked) return 'skipped';
  if (!record.previous) return 'manual';

  record.previous.click();
  if (!record.previous.checked) return 'skipped';
  if (isRadio(first)) clicked.delete(first);
  return 'restored';
}
