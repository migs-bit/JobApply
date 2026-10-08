import type { FillInstruction, FillResult, ResumeFile } from '../../shared/types';
import { plausibleKey, recordEvents, runSequence, SELECT_SEQUENCE, TEXT_SEQUENCE } from './event-sequence';
import { makeResult, querySafely } from './fill-result';
import { FILE_SETTLE_MS, fileStillAttached, isFileInput, startFileFill, undoFile } from './file-filler';
import { matchChoice, optionTexts } from './option-match';
import { isRadio, RADIO_SETTLE_MS, radioStillChosen, startRadioFill, undoRadio } from './radio-filler';
import { VERIFY_DELAY_MS, verifyResults } from './verify';
import { isVisibleToUser } from './visibility';

/**
 * Writes profile values into the page: text fields and dropdowns here, radio
 * groups in radio-filler.ts, the resume in file-filler.ts.
 *
 * Every target is re-checked at fill time, not trusted from the scan: the
 * page can change between scanning and filling (the service-worker round
 * trip is async), and a selector that pointed at a text box could now point
 * at a password field or a hidden one.
 *
 * Text fields and dropdowns are filled with a full focus → set → events →
 * blur sequence (event-sequence.ts), and every fill is re-checked once
 * everything is done (verify.ts).
 */

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const FILLABLE_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search']);

/**
 * What each successful fill wrote and what it replaced, for Undo and the
 * verification pass. Kept in the content script's isolated world (never
 * logged, never sent anywhere), and weakly keyed so a field the page removes
 * doesn't linger. `index` is the chosen option, for dropdowns.
 */
const applied = new WeakMap<Element, { filled: string; previous: string; index?: number }>();

/**
 * React-safe value write (Brief.md). Frameworks like React wrap an input's
 * `value` setter to track changes; assigning through that wrapper makes React
 * think nothing changed and it discards the input event. Calling the native
 * prototype setter bypasses the wrapper, so the events that follow look like
 * real user input. (Content scripts run in an isolated world where the page's
 * wrapper isn't visible anyway; using the prototype setter keeps this correct
 * in either world.) Fires no events: runSequence does that.
 */
export function writeNativeValue(el: Fillable, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

/** Fills a text field or textarea with the full TEXT_SEQUENCE. Returns the steps played. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): string[] {
  return runSequence(el, TEXT_SEQUENCE, { set: () => writeNativeValue(el, value), key: plausibleKey(value), data: value });
}

/**
 * Picks option `index` of a dropdown with the full SELECT_SEQUENCE: the
 * option is selected three ways (option.selected, selectedIndex, and the
 * native value setter), because different frameworks read different ones.
 */
export function chooseOption(select: HTMLSelectElement, index: number): string[] {
  const option = select.options[index];
  return runSequence(select, SELECT_SEQUENCE, {
    set: () => {
      if (option) option.selected = true;
      select.selectedIndex = index;
      writeNativeValue(select, option?.value ?? '');
    },
    ...(option ? { option } : {}),
  });
}

/**
 * Applies every instruction. Radio groups and file inputs are set first and
 * checked together after one short settle, so ten of them cost one wait,
 * not ten. Then, if anything was filled, every filled field is re-read after
 * VERIFY_DELAY_MS ("page reverted" if it changed). `resume` is the plan's
 * file, for instructions keyed `resume`.
 */
export async function applyFill(
  instructions: readonly FillInstruction[],
  doc: Document = document,
  resume?: ResumeFile,
): Promise<FillResult[]> {
  const pending = instructions.map((instruction) => {
    const el = querySafely(doc, instruction.selector);
    if (isRadio(el)) return startRadioFill(instruction, doc);
    // Resume instructions go to the file filler even if the target changed, so its guards report why.
    if (isFileInput(el) || instruction.key === 'resume') return startFileFill(instruction, resume, doc);
    return fillOne(instruction, doc);
  });
  if (pending.some((p) => typeof p === 'function')) await sleep(Math.max(RADIO_SETTLE_MS, FILE_SETTLE_MS));
  const results = pending.map((p) => (typeof p === 'function' ? p() : p));

  if (!results.some((r) => r.status === 'filled')) return results;
  await sleep(VERIFY_DELAY_MS);
  return verifyResults(results, (r) => stillHolds(r, doc));
}

/** Does the field still hold what this fill put there? */
export function stillHolds(result: FillResult, doc: Document = document): boolean {
  const el = querySafely(doc, result.selector);
  if (isRadio(el)) return radioStillChosen(result, doc);
  if (isFileInput(el)) return fileStillAttached(result, doc);
  const record = el ? applied.get(el) : undefined;
  if (!el || !record || !isFillable(el) || !el.isConnected) return false;
  if (el instanceof HTMLSelectElement) return el.selectedIndex === record.index && el.value === record.filled;
  return el.value === record.filled;
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

  let events: string[];
  let index: number | undefined;
  if (el instanceof HTMLSelectElement) {
    const match = matchChoice(Array.from(el.options), instruction.optionCandidates ?? [instruction.value], instruction.learnedOptions);
    if ('reason' in match) return result('skipped', previousValue, match.reason);
    if (choice) Object.assign(choice, { matched: match.matched, ...(match.viaLearned ? { viaLearned: true } : {}) });
    index = match.index;
    events = chooseOption(el, index);
  } else {
    if (el.maxLength >= 0 && instruction.value.length > el.maxLength) {
      // Truncating would silently submit wrong data (a cut-off email, a partial URL).
      return result('skipped', previousValue, 'value longer than the field allows');
    }
    events = typeInto(el, instruction.value);
  }
  recordEvents({ key: instruction.key, selector: instruction.selector, events });

  // A controlled input with no change handler, or a script that clears the
  // field, leaves it empty; report that instead of claiming success.
  if (el.value === '') return result('failed', previousValue, 'page did not keep the value');
  applied.set(el, { filled: el.value, previous: previousValue, ...(index !== undefined ? { index } : {}) });
  return result('filled', previousValue);
}

export interface UndoOutcome {
  restored: number;
  /** Selectors of radio groups whose answer had to stay (see undoRadio): the user changes these on the page. */
  manual: string[];
}

/**
 * Restores fields this extension filled to their previous values, with the
 * same event sequences as the fill, so the page's state follows. Only undoes
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
    if (isFileInput(el)) {
      if (undoFile(r, doc)) restored++;
      continue;
    }
    const record = el ? applied.get(el) : undefined;
    if (!el || !record || !isFillable(el) || el.value !== record.filled) continue;
    if (el instanceof HTMLSelectElement) {
      // -1 (no option) when the previous value matched none, as before the fill.
      chooseOption(el, Array.from(el.options).findIndex((o) => o.value === record.previous));
    } else {
      typeInto(el, record.previous);
    }
    applied.delete(el);
    restored++;
  }
  return { restored, manual };
}

function isFillable(el: Element): el is Fillable {
  if (el instanceof HTMLInputElement) return FILLABLE_INPUT_TYPES.has(el.type);
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
