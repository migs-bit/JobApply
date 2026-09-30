/**
 * Content script (step 6): scan the page, ask the service worker to resolve
 * each field to a profile key, and log both. No filling and no overlay yet.
 * The resolver's answer carries keys and confidence only, never profile values.
 *
 * It's injected on demand with chrome.scripting.executeScript (activeTab),
 * never declared in manifest.json `content_scripts`, so the extension has no
 * access to a page until the user asks. Each injection runs one fresh scan.
 *
 * All output goes through debug(), so production builds log nothing. Use
 * `npm run dev` to see it.
 */
import { REVIEW_THRESHOLD } from '../shared/constants';
import { debug, debugTable } from '../shared/log';
import { sendToBackground } from '../shared/messaging';
import type { FieldCandidate, ResolvedField } from '../shared/types';
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

  if (fields.length > 0) await logResolutions(fields);
}

async function logResolutions(fields: FieldCandidate[]): Promise<void> {
  const res = await sendToBackground<ResolvedField[]>({ type: 'RESOLVE_FIELDS', fields });
  if (!res.ok) {
    debug('resolve failed:', res.error);
    return;
  }

  const byId = new Map(fields.map((f) => [f.id, f]));
  const matched = res.data.filter((r) => r.key !== 'unknown');
  const review = matched.filter((r) => r.confidence < REVIEW_THRESHOLD).length;
  debug(`resolve: ${matched.length} of ${fields.length} matched, ${review} need review`);
  debugTable(
    res.data.map((r) => {
      const f = byId.get(r.fieldId);
      return {
        field: f ? f.label || f.ariaLabel || f.placeholder || f.name : r.fieldId,
        type: f ? f.type || f.tag : '',
        key: r.key,
        confidence: r.confidence,
        source: r.source,
        review: r.key !== 'unknown' && r.confidence < REVIEW_THRESHOLD,
        evidence: r.evidence,
      };
    }),
  );
  debug('resolutions', res.data);
}

const start = () => void run().catch((err: unknown) => console.error('Job Autofill scan failed', err));
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
