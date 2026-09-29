/**
 * Unique, re-findable CSS selectors for scanned fields, plus a stable id
 * derived from them.
 */

/**
 * Prefers `#id` when that id is unique on the page (duplicate ids are common
 * on real forms). Otherwise builds a `:nth-of-type` path, anchored at the
 * nearest ancestor with a unique id so changes elsewhere in the page don't
 * invalidate it.
 */
export function uniqueSelector(el: Element): string {
  const own = uniqueIdSelector(el);
  if (own) return own;

  const parts: string[] = [];
  let node: Element = el;
  for (;;) {
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(CSS.escape(node.localName)); // <html>
      break;
    }
    parts.unshift(`${CSS.escape(node.localName)}:nth-of-type(${indexAmongType(node)})`);
    const anchor = uniqueIdSelector(parent);
    if (anchor) {
      parts.unshift(anchor);
      break;
    }
    node = parent;
  }
  return parts.join(' > ');
}

function uniqueIdSelector(el: Element): string | null {
  if (!el.id) return null;
  const selector = `#${CSS.escape(el.id)}`;
  return el.ownerDocument.querySelectorAll(selector).length === 1 ? selector : null;
}

function indexAmongType(el: Element): number {
  let index = 1;
  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
    if (sib.localName === el.localName) index++;
  }
  return index;
}

/** FNV-1a: tiny, deterministic, good enough to turn a selector into a short id. */
export function hashId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f_${(hash >>> 0).toString(36)}`;
}
