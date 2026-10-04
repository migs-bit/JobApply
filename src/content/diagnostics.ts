/**
 * Dev-only diagnostics for the content script. Everything goes through
 * debug()/debugTable(), which compile to no-ops in production builds.
 * Text-field values are never logged; for dropdowns, the chosen option is.
 */
import { debug, debugTable } from '../shared/log';
import type { FieldCandidate, FillPlan, FillResult } from '../shared/types';
import { optionTexts } from './filler/option-match';
import type { scanFields } from './scanner/dom-scanner';


export function logScan(fields: FieldCandidate[], skipped: ReturnType<typeof scanFields>['skipped'], truncated: boolean, ms: number): void {
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

export function labelOf(fields: FieldCandidate[], fieldId: string): string {
  const f = fields.find((x) => x.id === fieldId);
  return f ? f.label || f.ariaLabel || f.placeholder || f.name : fieldId;
}

export function logResolutions(fields: FieldCandidate[], plan: FillPlan): void {
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

export function logFill(fields: FieldCandidate[], results: FillResult[]): void {
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

/**
 * One row per <select> on the page (dev builds only): resolved key, chosen
 * option, the options on offer, and the outcome. Makes "why didn't this
 * dropdown fill?" answerable without guessing.
 */
export function logSelectDiagnostics(fields: FieldCandidate[], plan: FillPlan, results: FillResult[]): void {
  const selects = fields.filter((f) => f.tag === 'select');
  if (selects.length === 0) return;
  debug(`selects: ${selects.length}`);
  debugTable(
    selects.map((f) => {
      const resolution = plan.resolutions.find((r) => r.fieldId === f.id);
      const result = results.find((r) => r.fieldId === f.id);
      const el = document.querySelector(f.selector);
      const options = result?.select?.options ?? (el instanceof HTMLSelectElement ? optionTexts(Array.from(el.options)) : []);
      const key = resolution?.key ?? 'unknown';
      return {
        field: labelOf(fields, f.id),
        key,
        status: result?.status ?? 'skipped',
        // A result means a fill was attempted; otherwise say why none was.
        reason: result ? (result.reason ?? '') : key === 'unknown' ? 'no matching profile key' : 'nothing saved for this key',
        'matched option': result?.select?.matched ?? (result ? 'no option matched' : ''),
        'available options': options.join(' | '),
      };
    }),
  );
}
