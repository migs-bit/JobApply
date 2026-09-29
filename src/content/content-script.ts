/**
 * Content script (step 5): scan the page and log what was found. Nothing
 * else: no resolver, no filler, no overlay.
 *
 * It's injected on demand with chrome.scripting.executeScript (activeTab),
 * never declared in manifest.json `content_scripts`, so the extension has no
 * access to a page until the user asks. Each injection runs one fresh scan.
 *
 * All output goes through debug(), so production builds log nothing. Use
 * `npm run dev` to see it.
 */
import { debug, debugTable } from '../shared/log';
import { scanFields } from './scanner/dom-scanner';

function run(): void {
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run, { once: true });
} else {
  run();
}
