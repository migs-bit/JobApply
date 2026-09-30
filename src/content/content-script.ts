/**
 * Content script: on FILL_PAGE from the popup, scan the page, get a fill plan
 * from the service worker, fill the fields, and reply with counts (never
 * values). No overlay yet (step 9).
 *
 * The popup injects it on demand with chrome.scripting.executeScript
 * (activeTab), and it's never declared in manifest.json `content_scripts`, so
 * the extension has no access to a page until the user asks. It registers its
 * listener once per page, so later clicks reuse it.
 *
 * Diagnostics go through debug(), so production builds log nothing. Use
 * `npm run dev` to see them. Logs never include filled values, even in dev.
 */
import { CONTENT_READY_FLAG } from '../shared/constants';
import { debug, debugTable } from '../shared/log';
import { sendToBackground } from '../shared/messaging';
import type { FieldCandidate, FillPlan, FillResult, FillSummary, MsgResponse } from '../shared/types';
import { applyFill } from './filler/dom-filler';
import { scanFields } from './scanner/dom-scanner';

const EXTENSION_PAGE_PREFIX = chrome.runtime.getURL('');

async function fillPage(): Promise<FillSummary> {
  const started = performance.now();
  const { fields, skipped, truncated } = scanFields(document);
  const ms = Math.round(performance.now() - started);
  logScan(fields, skipped, truncated, ms);

  const empty: FillSummary = { fields: fields.length, matched: 0, attempted: 0, filled: 0, needsReview: 0, failed: 0 };
  if (fields.length === 0) return empty;

  const res = await sendToBackground<FillPlan>({ type: 'RESOLVE_FIELDS', fields });
  if (!res.ok) throw new Error(`resolve failed: ${res.error}`);
  logResolutions(fields, res.data);

  const results = applyFill(res.data.instructions);
  logFill(fields, results);

  const filled = results.filter((r) => r.status === 'filled');
  return {
    ...empty,
    matched: res.data.resolutions.filter((r) => r.key !== 'unknown').length,
    attempted: results.length,
    filled: filled.length,
    needsReview: filled.filter((r) => r.requiresReview).length,
    failed: results.filter((r) => r.status === 'failed').length,
  };
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

// ---------------------------------------------------------------------------
// Dev-only diagnostics
// ---------------------------------------------------------------------------

function logScan(fields: FieldCandidate[], skipped: ReturnType<typeof scanFields>['skipped'], truncated: boolean, ms: number): void {
  debug(`scan: ${fields.length} field(s), ${skipped.length} skipped, ${ms} ms`);
  debugTable(
    fields.map((f) => ({
      tag: f.tag,
      type: f.type,
      name: f.name,
      autocomplete: f.autocomplete,
      label: f.label,
      placeholder: f.placeholder,
      ariaLabel: f.ariaLabel,
      nearbyText: f.nearbyText,
      selector: f.selector,
    })),
  );
  // Full objects too: right-click → "Copy object" to paste into a bug report.
  debug('fields', fields);
  if (skipped.length > 0) {
    debug('skipped', skipped.length);
    debugTable(skipped.map((s) => ({ ...s })));
  }
  if (truncated) debug('more fields than the per-page limit; the rest were not scanned');
  // Surface the MVP's known blind spots so "field not found" reports are easy to triage.
  const iframes = document.querySelectorAll('iframe').length;
  if (iframes > 0) debug(`${iframes} iframe(s) on this page were not scanned (MVP limitation)`);
}

function labelOf(fields: FieldCandidate[], fieldId: string): string {
  const f = fields.find((x) => x.id === fieldId);
  return f ? f.label || f.ariaLabel || f.placeholder || f.name : fieldId;
}

function logResolutions(fields: FieldCandidate[], plan: FillPlan): void {
  const matched = plan.resolutions.filter((r) => r.key !== 'unknown').length;
  debug(`resolve: ${matched} of ${fields.length} matched, ${plan.instructions.length} have a profile value`);
  debugTable(
    plan.resolutions.map((r) => ({
      field: labelOf(fields, r.fieldId),
      key: r.key,
      confidence: r.confidence,
      source: r.source,
      evidence: r.evidence,
    })),
  );
  debug('resolutions', plan.resolutions); // value-free; instructions are never logged
}

function logFill(fields: FieldCandidate[], results: FillResult[]): void {
  const count = (s: FillResult['status']) => results.filter((r) => r.status === s).length;
  const review = results.filter((r) => r.status === 'filled' && r.requiresReview).length;
  debug(`fill: ${count('filled')} filled (${review} need review), ${count('skipped')} skipped, ${count('failed')} failed`);
  debugTable(
    results.map((r) => ({
      field: labelOf(fields, r.fieldId),
      key: r.key,
      status: r.status,
      reason: r.reason ?? '',
      review: r.requiresReview,
      source: r.source,
    })),
  );
}
