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

/**
 * Whitespace-collapsed text of `node`, capped at `max` chars. Skips
 * non-context elements, and any text inside an element in `exclude`.
 */
export function textOf(
  node: Node,
  max: number = LIMITS.fieldTextLength,
  exclude: ReadonlySet<Element> = new Set(),
): string {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => {
      const parent = t.parentElement;
      if (!parent || parent.closest(NON_CONTEXT_TEXT)) return NodeFilter.FILTER_REJECT;
      // Hidden status/error text ("Couldn't auto-read resume") isn't what the
      // user sees. Screen-reader-only text is clipped, not hidden, so it stays.
      if (!isShown(parent)) return NodeFilter.FILTER_REJECT;
      // Inclusive of `node` itself: when the container being read *is* an
      // excluded element (e.g. the field's wrapping <label>), all its text is excluded.
      for (let el: Element | null = parent; el; el = el.parentElement) {
        if (exclude.has(el)) return NodeFilter.FILTER_REJECT;
        if (el === node) break;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = '';
  for (let t = walker.nextNode(); t && text.length <= max; t = walker.nextNode()) {
    text += ` ${t.nodeValue ?? ''}`;
  }
  return collapse(text).slice(0, max);
}

/** display:none (self or ancestor) or visibility:hidden → false. */
export function isShown(el: Element): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
  }
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
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

const MAX_CONTAINER_DEPTH = 8;

/**
 * The question or context text around a field: the closest ancestor with
 * text beyond the field's *own* text. Its own text is its label(s), the
 * option labels of its radio/checkbox group, and any button/link that wraps
 * it (e.g. a styled "Upload file" button around a file input); those
 * describe the control, not the question, and the label is reported
 * separately anyway.
 *
 * Any element type counts as a container (Lever puts questions in an <li>
 * next to the field's <div>), but climbing stops before a container that
 * holds *other* fields, whose text would describe the wrong field.
 */
export function nearbyText(el: FormControl, scannable: ReadonlySet<Element>): string {
  const group = groupOf(el, scannable);
  const ownText = ownTextElements(group);

  let node = el.parentElement;
  for (let depth = 0; node && node !== document.body && depth < MAX_CONTAINER_DEPTH; depth++) {
    if (containsOtherFields(node, group, scannable)) return '';
    const text = textOf(node, LIMITS.nearbyTextLength, ownText);
    if (text) return text;
    node = node.parentElement;
  }
  return '';
}

/** The field plus same-name radio/checkbox siblings: one question, several controls. */
function groupOf(el: FormControl, scannable: ReadonlySet<Element>): ReadonlySet<Element> {
  if (!el.name || !(el instanceof HTMLInputElement) || (el.type !== 'radio' && el.type !== 'checkbox')) {
    return new Set([el]);
  }
  const sameName = Array.from(document.getElementsByName(el.name)).filter(
    (other) => scannable.has(other) && (other as FormControl).form === el.form,
  );
  return new Set([el, ...sameName]);
}

function ownTextElements(group: ReadonlySet<Element>): ReadonlySet<Element> {
  const own = new Set<Element>();
  for (const control of group) {
    for (const label of (control as FormControl).labels ?? []) own.add(label);
    const wrapper = control.closest('a, button, [role="button"]');
    if (wrapper) own.add(wrapper);
    for (const id of control.getAttribute('aria-labelledby')?.split(/\s+/) ?? []) {
      const target = id ? document.getElementById(id) : null;
      if (target) own.add(target);
    }
  }
  return own;
}

function containsOtherFields(
  container: Element,
  group: ReadonlySet<Element>,
  scannable: ReadonlySet<Element>,
): boolean {
  for (const other of container.querySelectorAll('input, textarea, select')) {
    if (scannable.has(other) && !group.has(other)) return true;
  }
  return false;
}
