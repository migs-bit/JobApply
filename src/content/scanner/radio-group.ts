import { LIMITS } from '../../shared/constants';
import { collapse, resolveLabel, textOf } from './field-text';

/**
 * Radio groups: radios that share a `name` within the same form behave as one
 * question in the browser (checking one unchecks the others), so the scanner
 * reports them as one field.
 */

interface Groupable {
  name: string;
  form: unknown;
}

/**
 * Groups radios by (form, name), in order of first appearance. Pure (no DOM),
 * so it's unit tested directly. A radio without a name is its own group: the
 * browser doesn't link it to any other radio.
 */
export function groupRadios<T extends Groupable>(radios: readonly T[]): T[][] {
  const byForm = new Map<unknown, Map<string, T[]>>();
  const groups: T[][] = [];
  for (const radio of radios) {
    if (!radio.name) {
      groups.push([radio]);
      continue;
    }
    let byName = byForm.get(radio.form);
    if (!byName) byForm.set(radio.form, (byName = new Map()));
    let group = byName.get(radio.name);
    if (!group) {
      byName.set(radio.name, (group = []));
      groups.push(group);
    }
    group.push(radio);
  }
  return groups;
}

/**
 * The group's own label, when the page provides one: a <fieldset>'s <legend>,
 * or a role="radiogroup" container's aria-labelledby / aria-label. Empty
 * otherwise; the question then comes from the group's nearby text.
 */
export function radioGroupLabel(radios: readonly HTMLInputElement[]): { label: string; ariaLabel: string } {
  const [first] = radios;
  if (!first) return { label: '', ariaLabel: '' };
  const containsAll = (el: Element | null): el is Element => !!el && radios.every((r) => el.contains(r));

  const fieldset = first.closest('fieldset');
  const legend = containsAll(fieldset) ? fieldset.querySelector(':scope > legend') : null;
  if (legend) {
    const text = textOf(legend);
    if (text) return { label: text, ariaLabel: '' };
  }

  const group = first.closest('[role="radiogroup"]');
  if (!containsAll(group)) return { label: '', ariaLabel: '' };
  const labelledBy = (group.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => (id ? document.getElementById(id) : null))
    .filter((n): n is HTMLElement => n !== null)
    .map((n) => textOf(n))
    .join(' ');
  return {
    label: collapse(labelledBy).slice(0, LIMITS.fieldTextLength),
    ariaLabel: collapse(group.getAttribute('aria-label') ?? '').slice(0, LIMITS.fieldTextLength),
  };
}

/** A radio's option text: its label, or its value if it has none. */
export function radioOptionLabel(radio: HTMLInputElement): string {
  return (resolveLabel(radio) || collapse(radio.value)).slice(0, LIMITS.fieldTextLength);
}
