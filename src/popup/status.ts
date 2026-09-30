import type { FillSummary } from '../shared/types';

/**
 * The popup's one-line status for a finished fill. Counts only: the popup
 * never sees, shows, or logs profile values.
 */
export function fillStatus(s: FillSummary): string {
  if (s.fields === 0) return 'No form fields found on this page.';
  if (s.attempted === 0) {
    return s.matched === 0
      ? 'Nothing to fill on this page.'
      : 'Nothing to fill: no saved details for the fields found.';
  }
  if (s.filled === 0) return 'Nothing to fill: those fields are already filled or hidden.';

  const parts = [`Filled ${s.filled} of ${s.attempted} field${s.attempted === 1 ? '' : 's'}`];
  if (s.needsReview > 0) parts.push(`${s.needsReview} to review`);
  if (s.failed > 0) parts.push(`${s.failed} didn't stick`);
  return `${parts.join(' · ')}.`;
}
