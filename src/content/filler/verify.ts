import type { FillResult } from '../../shared/types';

/**
 * Post-fill verification. Some pages accept a value, then put back their own
 * a moment later (a framework re-render from stale state, a script that
 * resets the field). The fill looked fine, but the form would submit
 * something else. So after everything is filled, wait, re-read each filled
 * field, and report any that changed as "page reverted".
 */

/** How long to wait after the last fill before re-reading. */
export const VERIFY_DELAY_MS = 200;

export const REVERTED = 'page reverted';

/**
 * Marks each filled result whose field no longer holds what was filled as
 * failed. Pure: `stillHolds` does the DOM reading, so this is unit tested.
 */
export function verifyResults(results: readonly FillResult[], stillHolds: (r: FillResult) => boolean): FillResult[] {
  return results.map((r) => {
    if (r.status !== 'filled' || stillHolds(r)) return r;
    const { attached: _attached, ...rest } = r;
    return { ...rest, status: 'failed', reason: REVERTED };
  });
}
