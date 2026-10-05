import type { ResolvableKey, ResolverSource } from '../../shared/types';
import type { UndoOutcome } from '../filler/dom-filler';
import { OVERLAY_CSS, REVIEW_OUTLINE } from './overlay-styles';

/**
 * Confirmation overlay: a floating panel listing what was filled, with
 * confidence and source tier. Low-confidence rows (and their fields on the
 * page) are highlighted; Undo restores previous values; it auto-dismisses
 * when every fill is high-confidence.
 *
 * Security: a *closed* shadow root, so page scripts can't read or drive the
 * panel. It's built with textContent only, never innerHTML, because labels
 * come from the page. It shows only values this extension filled, which are
 * already in the page's own fields.
 */

export interface OverlayRow {
  label: string;
  key: ResolvableKey;
  /** The filled value; empty for failed rows. */
  value: string;
  confidence: number;
  source: ResolverSource;
  requiresReview: boolean;
  status: 'filled' | 'failed';
  reason?: string;
  selector: string;
}

export interface OverlayOptions {
  rows: OverlayRow[];
  skipped: number;
  /** Restores filled fields; reports how many were restored and which radio answers must be changed by hand. */
  onUndo: () => UndoOutcome;
}

const AUTO_DISMISS_MS = 6000;
let current: { close: () => void } | null = null;

export function closeOverlay(): void {
  current?.close();
}

export function showOverlay({ rows, skipped, onUndo }: OverlayOptions): void {
  closeOverlay(); // one panel at a time; a re-fill replaces it

  const host = document.createElement('job-autofill-overlay');
  // Inline !important beats any page stylesheet rule aimed at the host element.
  host.style.cssText = 'all: initial !important; display: block !important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(OVERLAY_CSS);
  shadow.adoptedStyleSheets = [sheet];

  const filled = rows.filter((r) => r.status === 'filled');
  const review = filled.filter((r) => r.requiresReview).length;
  const failed = rows.length - filled.length;

  const panel = el('section', 'panel');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Job Autofill results');

  const header = el('header');
  const summary = el('p', 'summary', summaryText(filled.length, review, failed, skipped));
  summary.setAttribute('role', 'status');
  header.append(el('h2', '', 'Job Autofill'), summary);

  // What needs attention first: failures, then low-confidence fills, then the rest (stable within each group).
  const rank = (r: OverlayRow) => (r.status === 'failed' ? 0 : r.requiresReview ? 1 : 2);
  const list = el('ul');
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b));
  const items = sorted.map((row) => renderRow(row));
  list.append(...items);

  const undo = el('button', 'action', 'Undo');
  const close = el('button', 'action primary', 'Close');
  const footer = el('footer');
  footer.append(undo, close);

  panel.append(header, list, footer);
  shadow.append(panel);
  document.documentElement.append(host);

  // Mark low-confidence fields on the page too; remember their old outline to restore.
  const outlined: Array<{ field: HTMLElement; outline: string; offset: string }> = [];
  for (const row of filled.filter((r) => r.requiresReview)) {
    const field = document.querySelector<HTMLElement>(row.selector);
    if (!field) continue;
    outlined.push({ field, outline: field.style.outline, offset: field.style.outlineOffset });
    field.style.outline = REVIEW_OUTLINE.outline;
    field.style.outlineOffset = REVIEW_OUTLINE.outlineOffset;
  }
  const clearOutlines = () => {
    for (const { field, outline, offset } of outlined.splice(0)) {
      field.style.outline = outline;
      field.style.outlineOffset = offset;
    }
  };

  // Auto-dismiss only when there's nothing to double-check; pause while the user is on the panel.
  let timer: number | undefined;
  let autoDismiss = review === 0 && failed === 0;
  const stopTimer = () => window.clearTimeout(timer);
  const startTimer = () => {
    stopTimer();
    if (autoDismiss) timer = window.setTimeout(doClose, AUTO_DISMISS_MS);
  };

  function doClose(): void {
    stopTimer();
    clearOutlines();
    host.remove();
    if (current?.close === doClose) current = null;
  }

  undo.addEventListener('click', () => {
    autoDismiss = false; // after an undo, the user closes the panel
    stopTimer();
    const { restored, manual } = onUndo();
    clearOutlines();
    // Rows that were undone are dimmed; radio answers that stayed keep their normal look.
    items.forEach((item, i) => {
      if (!manual.includes(sorted[i]?.selector ?? '')) item.classList.add('undone');
    });
    summary.textContent =
      `Restored ${restored} field${restored === 1 ? '' : 's'}.` +
      (manual.length
        ? ` ${manual.length} radio answer${manual.length === 1 ? '' : 's'} can't be cleared automatically: change ${manual.length === 1 ? 'it' : 'them'} on the page.`
        : '');
    undo.hidden = true;
    close.focus();
  });
  close.addEventListener('click', doClose);
  shadow.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') doClose();
  });
  panel.addEventListener('mouseenter', stopTimer);
  panel.addEventListener('mouseleave', startTimer);
  panel.addEventListener('focusin', stopTimer);
  panel.addEventListener('focusout', startTimer);

  current = { close: doClose };
  startTimer();
}

function renderRow(row: OverlayRow): HTMLLIElement {
  const li = el('li', row.status === 'failed' ? 'failed' : row.requiresReview ? 'review' : '');
  const button = el('button', 'row');
  button.type = 'button';
  button.title = 'Show this field';

  const badge = row.status === 'failed' ? "Didn't stick" : row.requiresReview ? 'Review' : 'Filled';
  const meta =
    row.status === 'failed'
      ? (row.reason ?? 'The page did not keep the value')
      : `${row.key} · ${Math.round(row.confidence * 100)}% · ${row.source}`;
  button.append(el('span', 'label', row.label || row.key), el('span', 'badge', badge));
  if (row.value) button.append(el('span', 'value', truncate(row.value, 60)));
  button.append(el('span', 'meta', meta));

  button.addEventListener('click', () => {
    const field = document.querySelector<HTMLElement>(row.selector);
    field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    field?.focus({ preventScroll: true });
  });
  li.append(button);
  return li;
}

function summaryText(filled: number, review: number, failed: number, skipped: number): string {
  const parts = [`Filled ${filled} field${filled === 1 ? '' : 's'}`];
  if (review > 0) parts.push(`${review} to review`);
  if (failed > 0) parts.push(`${failed} didn't stick`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  return `${parts.join(' · ')}.`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
