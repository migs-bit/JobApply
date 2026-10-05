/**
 * Content script: on FILL_PAGE from the popup, scan the page, get a fill plan
 * from the service worker, fill the fields, show the confirmation overlay,
 * and reply to the popup with counts (never values).
 *
 * The popup injects it on demand with chrome.scripting.executeScript
 * (activeTab), and it's never declared in manifest.json `content_scripts`, so
 * the extension has no access to a page until the user asks. It registers its
 * listener once per page, so later clicks reuse it.
 *
 * Diagnostics go through debug(), so production builds log nothing. Use
 * `npm run dev` to see them. Text-field values are never logged; for
 * dropdowns and radio groups, dev builds log which option was chosen so matching failures can
 * be diagnosed.
 */
import { CONTENT_READY_FLAG } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';
import type { FieldCandidate, FillPlan, FillResult, FillSummary, MsgResponse } from '../shared/types';
import { labelOf, logChoiceDiagnostics, logFill, logResolutions, logScan } from './diagnostics';
import { applyFill, undoFill } from './filler/dom-filler';
import { showOverlay, type OverlayRow } from './overlay/confirmation-ui';
import { teach, teachableFields } from './teach';
import { scanFields } from './scanner/dom-scanner';

const EXTENSION_PAGE_PREFIX = chrome.runtime.getURL('');

async function fillPage(): Promise<FillSummary> {
  const started = performance.now();
  const { fields, skipped, truncated } = scanFields(document);
  const ms = Math.round(performance.now() - started);
  logScan(fields, skipped, truncated, ms);

  const empty: FillSummary = {
    fields: fields.length,
    matched: 0,
    attempted: 0,
    filled: 0,
    needsReview: 0,
    failed: 0,
    teachable: 0,
    overlayShown: false,
  };
  if (fields.length === 0) return empty;

  const res = await sendToBackground<FillPlan>({ type: 'RESOLVE_FIELDS', fields });
  if (!res.ok) throw new Error(`resolve failed: ${res.error}`);
  logResolutions(fields, res.data);

  const results = await applyFill(res.data.instructions);
  logFill(fields, results);
  logChoiceDiagnostics(fields, res.data, results);
  const { overlayShown, teachable } = presentResults(fields, res.data, results);

  const filled = results.filter((r) => r.status === 'filled');
  return {
    ...empty,
    matched: res.data.resolutions.filter((r) => r.key !== 'unknown').length,
    attempted: results.length,
    filled: filled.length,
    needsReview: filled.filter((r) => r.requiresReview).length,
    failed: results.filter((r) => r.status === 'failed').length,
    teachable,
    overlayShown,
  };
}

/**
 * Shows the overlay for anything filled, failed, or teachable, and reports
 * whether it did. Runs with none of those are left to the popup's status line.
 */
function presentResults(fields: FieldCandidate[], plan: FillPlan, results: FillResult[]): { overlayShown: boolean; teachable: number } {
  const values = new Map(plan.instructions.map((i) => [i.fieldId, i.value]));
  const rows: OverlayRow[] = results
    .filter((r) => r.status !== 'skipped')
    .map((r) => ({
      label: labelOf(fields, r.fieldId),
      key: r.key,
      // For dropdowns and radios, show the option actually chosen ("I am not a veteran"), not the generic label.
      value: r.status === 'filled' ? (r.choice?.matched ?? values.get(r.fieldId) ?? '') : '',
      confidence: r.confidence,
      source: r.source,
      requiresReview: r.requiresReview,
      status: r.status === 'filled' ? 'filled' : 'failed',
      ...(r.reason ? { reason: r.reason } : {}),
      selector: r.selector,
    }));
  const teachable = teachableFields(fields, plan, results);
  if (rows.length === 0 && teachable.length === 0) return { overlayShown: false, teachable: 0 };
  const byField = new Map(teachable.map((t) => [t.row.fieldId, t]));
  showOverlay({
    rows,
    skipped: results.filter((r) => r.status === 'skipped').length,
    onUndo: () => undoFill(results),
    teachable: teachable.map((t) => t.row),
    onTeach: async (fieldId) => {
      const item = byField.get(fieldId);
      return item ? teach(item) : { ok: false, message: 'That field is no longer on the page.' };
    },
  });
  return { overlayShown: true, teachable: teachable.length };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

/** Only our own extension pages (the popup) may trigger a fill; other content scripts can't. */
function isFromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab === undefined && !!sender.url?.startsWith(EXTENSION_PAGE_PREFIX);
}

function isFillPageMsg(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'FILL_PAGE';
}

const globals = globalThis as unknown as Record<string, unknown>;
if (globals[CONTENT_READY_FLAG] !== true) {
  globals[CONTENT_READY_FLAG] = true;

  // A double click shouldn't fill twice; share the in-flight run instead.
  let inFlight: Promise<FillSummary> | null = null;

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (!isFillPageMsg(raw) || !isFromExtensionPage(sender)) return false;

    inFlight ??= fillPage().finally(() => {
      inFlight = null;
    });
    inFlight
      .then((data) => sendResponse({ ok: true, data } satisfies MsgResponse<FillSummary>))
      .catch((err: unknown) => {
        console.error('Job Autofill failed', err);
        sendResponse({ ok: false, error: 'Fill failed' } satisfies MsgResponse<FillSummary>);
      });
    return true; // async response
  });
}
