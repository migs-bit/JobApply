/**
 * "Can the user see this?" Filling only what the user can see blocks a known
 * autofill-phishing trick: hidden fields that harvest data the user never sees
 * being filled.
 */

const MIN_VISIBLE_PX = 4;

/**
 * Stricter than the scanner's check (which keeps opacity-0 controls so they
 * show up in diagnostics). An element counts as visible only if:
 * - it and its ancestors aren't display:none, visibility:hidden, or opacity 0;
 * - its *visible* area, after clipping by `clip`, `clip-path`, and every
 *   overflow-clipping ancestor, is at least MIN_VISIBLE_PX on each side.
 *   This catches the "screen-reader only" pattern (1px + clip), where an
 *   input's padding still gives it a normal-looking box;
 * - it isn't pushed off the page with negative positioning.
 */
export function isVisibleToUser(el: Element): boolean {
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

/**
 * A radio counts as visible if the radio itself or its label is. Many sites
 * (Ashby, custom-styled forms) hide the native radio dot and show a styled
 * label instead. The label is what the user sees and clicks, and its text is
 * the answer, so the user can see what's being chosen. A group where neither
 * is visible is still never touched.
 */
export function isRadioVisibleToUser(radio: HTMLInputElement): boolean {
  if (isVisibleToUser(radio)) return true;
  const labels = [...(radio.labels ?? [])];
  const wrapping = radio.closest('label');
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
  return labels.some(isVisibleToUser);
}

/**
 * What the user sees of a file input: the input itself, or the label / styled
 * button wrapped around it. Upload buttons almost always hide the native
 * input (Lever: an opacity-0, 1px input inside a visible "ATTACH RESUME/CV"
 * link) and show their own control, whose text says what it's for. Returns
 * null when none of those is visible: a file input the user can't see is
 * never touched.
 */
export function visibleFileTarget(input: HTMLInputElement): Element | null {
  if (isVisibleToUser(input)) return input;
  const candidates: Element[] = [...(input.labels ?? [])];
  for (const wrapper of [input.closest('label'), input.closest('a, button, [role="button"]')]) {
    if (wrapper && !candidates.includes(wrapper)) candidates.push(wrapper);
  }
  return candidates.find(isVisibleToUser) ?? null;
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
