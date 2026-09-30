/**
 * Content script (step 7): scan the page, get a fill plan from the service
 * worker, fill the fields, and log what happened. No overlay yet (step 9).
 *
 * It's injected on demand with chrome.scripting.executeScript (activeTab),
 * never declared in manifest.json `content_scripts`, so the extension has no
 * access to a page until the user asks. Each injection runs one fresh pass;
 * running it again skips fields that are already filled.
 *
 * All output goes through debug(), so production builds log nothing. Use
 * `npm run dev` to see it. Logs never include filled values, even in dev.
 */
import { debug, debugTable } from '../shared/log';
import { sendToBackground } from '../shared/messaging';
import type { FieldCandidate, FillPlan, FillResult } from '../shared/types';
import { applyFill } from './filler/dom-filler';
import { scanFields } from './scanner/dom-scanner';

async function run(): Promise<void> {
  const started = performance.now();
  const { fields, skipped, truncated } = scanFields(document);
  const ms = Math.round(performance.now() - started);

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

  if (fields.length === 0) return;

  const res = await sendToBackground<FillPlan>({ type: 'RESOLVE_FIELDS', fields });
  if (!res.ok) {
    debug('resolve failed:', res.error);
    return;
  }
  logResolutions(fields, res.data);

  const results = applyFill(res.data.instructions);
  logFill(fields, results);
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

const start = () => void run().catch((err: unknown) => console.error('Job Autofill failed', err));
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
