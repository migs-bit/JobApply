import type { FillResult } from '../../shared/types';
import { findFieldElement } from '../scanner/dom-scanner';

/**
 * Confirmation overlay — a small fixed panel listing what was filled, with
 * confidence scores. Low-confidence fills are highlighted both in the panel
 * and on the page so the user can double-check them.
 *
 * The panel lives in its own shadow root so page CSS can't break it (and our
 * CSS can't leak into the page). All page-derived text is set via
 * textContent, never innerHTML.
 */

const HOST_ID = 'jobapply-overlay-host';
const REVIEW_OUTLINE = '2px solid #f59e0b';
const FILLED_OUTLINE = '2px solid #22c55e';

const STYLES = `
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 340px; max-height: 70vh; display: flex; flex-direction: column;
    font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #111827;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.15); overflow: hidden;
  }
  header { display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; background: #111827; color: #fff; font-weight: 600; }
  header button { all: unset; cursor: pointer; font-size: 16px; padding: 0 4px; }
  .summary { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #4b5563; }
  ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
  li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px;
    padding: 8px 12px; border-bottom: 1px solid #f3f4f6; cursor: pointer; }
  li:hover { background: #f9fafb; }
  li.review { background: #fffbeb; }
  .label { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { grid-column: 1 / -1; color: #6b7280; font-size: 12px; }
  .badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; align-self: start; }
  .filled { background: #dcfce7; color: #166534; }
  .review .filled { background: #fef3c7; color: #92400e; }
  .skipped { background: #f3f4f6; color: #4b5563; }
  .failed { background: #fee2e2; color: #991b1b; }
`;

/** Elements we outlined, with their original outline, so we can restore them. */
let outlined: Array<{ el: HTMLElement; outline: string }> = [];

export function showConfirmationOverlay(results: FillResult[]): void {
  removeOverlay();

  const filled = results.filter((r) => r.status === 'filled');
  const needsReview = filled.filter((r) => r.instruction.needsReview);

  // Outline filled fields on the page.
  for (const r of filled) {
    const el = findFieldElement(r.instruction.fieldId);
    if (!el) continue;
    outlined.push({ el, outline: el.style.outline });
    el.style.outline = r.instruction.needsReview ? REVIEW_OUTLINE : FILLED_OUTLINE;
  }

  const { shadow } = createHost();
  const panel = h('div', 'panel');

  const header = h('header', '', 'JobApply Autofill');
  const close = h('button', '', '×');
  close.title = 'Close';
  close.addEventListener('click', removeOverlay);
  header.append(close);

  const summary = h(
    'div',
    'summary',
    `Filled ${filled.length} of ${results.length} fields` +
      (needsReview.length ? ` · ${needsReview.length} need review` : ''),
  );

  // Review-needed first, then other fills, then skips/failures.
  const rank = (r: FillResult) =>
    r.status === 'filled' ? (r.instruction.needsReview ? 0 : 1) : r.status === 'failed' ? 2 : 3;
  const list = h('ul');
  for (const r of [...results].sort((a, b) => rank(a) - rank(b))) {
    list.append(renderRow(r));
  }

  panel.append(header, summary, list);
  shadow.append(panel);
}

/** Minimal toast for status/errors (reuses the overlay host). */
export function showToast(message: string): void {
  removeOverlay();
  const { shadow } = createHost();
  const panel = h('div', 'panel');
  const header = h('header', '', 'JobApply Autofill');
  const close = h('button', '', '×');
  close.addEventListener('click', removeOverlay);
  header.append(close);
  panel.append(header, h('div', 'summary', message));
  shadow.append(panel);
  setTimeout(removeOverlay, 5000);
}

export function removeOverlay(): void {
  document.getElementById(HOST_ID)?.remove();
  for (const { el, outline } of outlined) el.style.outline = outline;
  outlined = [];
}

// --- Helpers ----------------------------------------------------------------

function renderRow(r: FillResult): HTMLElement {
  const { instruction } = r;
  const li = h('li', r.status === 'filled' && instruction.needsReview ? 'review' : '');

  const badgeText =
    r.status === 'filled' ? (instruction.needsReview ? 'review' : 'filled') : r.status;
  const confidence = `${Math.round(instruction.confidence * 100)}%`;
  const detail =
    r.status === 'filled'
      ? `${instruction.key} · ${confidence} · "${truncate(instruction.value, 40)}"`
      : `${instruction.key} · ${confidence} · ${r.reason ?? ''}`;

  li.append(h('span', 'label', r.label || '(unnamed field)'), h('span', `badge ${r.status}`, badgeText));
  li.append(h('span', 'meta', detail));

  // Clicking a row scrolls to and focuses the field.
  li.addEventListener('click', () => {
    const el = findFieldElement(instruction.fieldId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  });
  return li;
}

function createHost(): { shadow: ShadowRoot } {
  const host = document.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.append(style);
  document.documentElement.append(host);
  return { shadow };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
