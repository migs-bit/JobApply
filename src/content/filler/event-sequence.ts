/**
 * The event sequences the filler plays on text fields and dropdowns, so a
 * fill looks to the page like a person using the field: focus it, type or
 * pick, leave it.
 *
 * Why so many events: frameworks don't all listen for the same thing. React
 * reads `input` (and `change` on selects), but form libraries commonly commit
 * a field's value to their own state on `blur`, validate on `keyup`, or track
 * "touched" on `focus`; some dropdown components only react to mouse events.
 * Firing just `input` + `change` let the page *show* the value while its
 * internal state stayed empty, so the field submitted blank.
 *
 * `focusin` / `focusout` follow `focus` / `blur` because React's onFocus and
 * onBlur listen for those (they bubble; focus/blur don't). And they must be
 * dispatched by hand: the fill runs while the popup has keyboard focus, and
 * in a page without focus `element.focus()` / `blur()` fire no events at all.
 *
 * The sequences are plain data, so the order is unit tested without a DOM.
 * See CONTRIBUTING.md ("Fill event sequence") before changing them.
 */

export type Step =
  /** Call element.focus() / element.blur(), which moves real focus (and fires the browser's own events if the window is focused). */
  | { do: 'focus()' | 'blur()' }
  /** Write the value: the native setter for text fields; option.selected + selectedIndex + value for dropdowns. */
  | { do: 'set value' }
  /** Dispatch a synthetic event, on the element itself or (dropdowns) on the chosen <option>. */
  | { do: 'dispatch'; type: EventType; on?: 'option' };

export type EventType = 'focus' | 'focusin' | 'blur' | 'focusout' | 'keydown' | 'keyup' | 'input' | 'change' | 'mousedown' | 'mouseup' | 'click';

const call = (method: 'focus()' | 'blur()'): Step => ({ do: method });
const fire = (type: EventType, on?: 'option'): Step => (on ? { do: 'dispatch', type, on } : { do: 'dispatch', type });

/** Text inputs and textareas. */
export const TEXT_SEQUENCE: readonly Step[] = [
  call('focus()'),
  { do: 'set value' },
  fire('focus'),
  fire('focusin'),
  fire('keydown'),
  fire('input'),
  fire('keyup'),
  fire('change'),
  call('blur()'),
  fire('blur'),
  fire('focusout'),
];

/** Native <select> dropdowns. */
export const SELECT_SEQUENCE: readonly Step[] = [
  call('focus()'),
  { do: 'set value' },
  fire('focus'),
  fire('focusin'),
  fire('mousedown'),
  fire('mouseup'),
  fire('click', 'option'),
  fire('click'),
  fire('input'),
  fire('change'),
  call('blur()'),
  fire('blur'),
  fire('focusout'),
];

/** A readable label per step, for dev diagnostics. Never includes the value or the key typed. */
export function describeStep(step: Step): string {
  if (step.do !== 'dispatch') return step.do;
  return step.on === 'option' ? `${step.type} (option)` : step.type;
}

export interface RunOptions {
  /** Writes the value (the 'set value' step). */
  set: () => void;
  /** The <option> to target, for dropdowns. */
  option?: HTMLOptionElement;
  /** Key reported by keydown/keyup. */
  key?: string;
  /** The text inserted, for the `input` event's `data`. */
  data?: string;
}

/** Plays `steps` on `el`. Returns the labels of what was done, in order. */
export function runSequence(el: HTMLElement, steps: readonly Step[], opts: RunOptions): string[] {
  const done: string[] = [];
  for (const step of steps) {
    switch (step.do) {
      case 'focus()':
        el.focus({ preventScroll: true }); // fill without jumping the page to each field
        break;
      case 'blur()':
        el.blur();
        break;
      case 'set value':
        opts.set();
        break;
      case 'dispatch': {
        const target = step.on === 'option' ? opts.option : el;
        if (!target) continue;
        target.dispatchEvent(makeEvent(step.type, el, opts));
        break;
      }
    }
    done.push(describeStep(step));
  }
  return done;
}

function makeEvent(type: EventType, el: HTMLElement, opts: RunOptions): Event {
  switch (type) {
    case 'focus':
    case 'blur':
      return new FocusEvent(type); // real focus/blur don't bubble
    case 'focusin':
    case 'focusout':
      return new FocusEvent(type, { bubbles: true, composed: true });
    case 'keydown':
    case 'keyup':
      return new KeyboardEvent(type, { key: opts.key ?? 'Unidentified', bubbles: true, cancelable: true, composed: true });
    case 'mousedown':
    case 'mouseup':
    case 'click':
      return new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 });
    case 'input':
      // What a browser fires after typing into a text box; a plain Event for a dropdown, as browsers do.
      return el instanceof HTMLSelectElement
        ? new Event('input', { bubbles: true, composed: true })
        : new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: opts.data ?? null });
    case 'change':
      return new Event('change', { bubbles: true });
  }
}

/** A plausible key for the synthetic keydown/keyup: the last character typed, or Backspace when clearing (Undo). */
export function plausibleKey(value: string): string {
  if (value === '') return 'Backspace';
  const last = Array.from(value).pop();
  return last && last.trim() ? last : 'Unidentified';
}

// ---------------------------------------------------------------------------
// Dev-only record of what was dispatched, for the diagnostics table
// ---------------------------------------------------------------------------

export interface EventRecord {
  key: string;
  selector: string;
  /** Step labels from describeStep (never a value or the key typed). */
  events: string[];
}

const records: EventRecord[] = [];

/** Remembers a field's event sequence for diagnostics. A no-op in production builds. */
export function recordEvents(record: EventRecord): void {
  if (import.meta.env.DEV) records.push(record);
}

/** Returns and clears the records collected since the last call. */
export function takeEventRecords(): EventRecord[] {
  return records.splice(0);
}
