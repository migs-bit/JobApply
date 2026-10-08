import type { FillSummary } from '../shared/types';

/**
 * The popup's one-line status for a finished fill. Counts only: the popup
 * never sees, shows, or logs profile values.
 */
export function fillStatus(s: FillSummary): string {
  if (s.fields === 0) return 'No form fields found on this page.';
  const noResume = s.resumeMissing ? ' This page asks for a resume: upload one in Options.' : '';
  if (s.attempted === 0) {
    if (s.resumeMissing && s.matched === 1) return 'This page asks for a resume, but none is uploaded. Add one in Options.';
    return (s.matched === 0 ? 'Nothing to fill on this page.' : 'Nothing to fill: no saved details for the fields found.') + noResume;
  }
  if (s.filled === 0) return `Nothing to fill: those fields are already filled or hidden.${noResume}`;

  const parts = [`Filled ${s.filled} of ${s.attempted} field${s.attempted === 1 ? '' : 's'}`];
  if (s.resumeAttached) parts.push('resume attached');
  if (s.needsReview > 0) parts.push(`${s.needsReview} to review`);
  if (s.failed > 0) parts.push(`${s.failed} didn't stick`);
  if (s.resumeMissing) parts.push('no resume uploaded');
  return `${parts.join(' · ')}.`;
}
