import { LIMITS } from '../../shared/constants';

/**
 * Human-readable text around a field: its label and nearby container text.
 *
 * Privacy: text inside <textarea>, <select>, and <option> is never read.
 * A textarea's text content is its (possibly prefilled) value, and option
 * text is page data, not context for this field.
 */

export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const NON_CONTEXT_TEXT = 'textarea, select, option, datalist, script, style, template, noscript';

/** Whitespace-collapsed text of `node`, skipping non-context elements, capped at `max` chars. */
export function textOf(node: Node, max: number = LIMITS.fieldTextLength): string {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) =>
      t.parentElement?.closest(NON_CONTEXT_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });

  let text = '';
  for (let t = walker.nextNode(); t && text.length <= max; t = walker.nextNode()) {
    text += ` ${t.nodeValue ?? ''}`;
  }
  return collapse(text).slice(0, max);
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Label, resolved in order (Brief.md step 5): explicit <label for>, wrapping
 * <label>, then aria-labelledby. Empty string if none.
 */
export function resolveLabel(el: FormControl): string {
  if (el.id) {
    const explicit = Array.from(el.labels ?? []).filter((l) => l.htmlFor === el.id);
    const text = collapse(explicit.map((l) => textOf(l)).join(' '));
    if (text) return text.slice(0, LIMITS.fieldTextLength);
  }

  const wrapping = el.closest('label');
  // A wrapping label with for="other-id" labels a different control.
  if (wrapping && (!wrapping.htmlFor || wrapping.htmlFor === el.id)) {
    const text = textOf(wrapping);
    if (text) return text;
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null)
      .map((n) => textOf(n))
      .join(' ');
    return collapse(text).slice(0, LIMITS.fieldTextLength);
  }
  return '';
}

const MAX_CONTAINER_DEPTH = 6;

/**
 * Text of the closest <div> or <fieldset> that says something about this
 * field. Climbs past empty wrappers, but stops before a container that also
 * holds *other* fields, whose labels would describe the wrong field. Radio
 * and checkbox siblings with the same `name` don't count as other fields, so
 * a group's <fieldset>/<legend> question is still captured.
 */
export function nearbyText(el: FormControl, scannable: ReadonlySet<Element>): string {
  let node = el.parentElement;
  for (let depth = 0; node && node !== document.body && depth < MAX_CONTAINER_DEPTH; depth++) {
    if (node.localName === 'div' || node.localName === 'fieldset') {
      if (containsOtherFields(node, el, scannable)) return '';
      const text = textOf(node, LIMITS.nearbyTextLength);
      if (text) return text;
    }
    node = node.parentElement;
  }
  return '';
}

function containsOtherFields(container: Element, el: FormControl, scannable: ReadonlySet<Element>): boolean {
  for (const other of container.querySelectorAll('input, textarea, select')) {
    if (other === el || !scannable.has(other)) continue;
    const sameGroup = el.name !== '' && (other as FormControl).name === el.name;
    if (!sameGroup) return true;
  }
  return false;
}
