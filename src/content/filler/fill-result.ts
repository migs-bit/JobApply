import type { FillInstruction, FillResult } from '../../shared/types';

/** Builds a FillResult for `instruction`. Never includes a filled text value. */
export function makeResult(
  instruction: FillInstruction,
  status: FillResult['status'],
  previousValue: string,
  reason?: string,
  choice?: FillResult['choice'],
): FillResult {
  const { fieldId, key, selector, confidence, source, requiresReview } = instruction;
  return {
    fieldId,
    key,
    selector,
    status,
    ...(reason ? { reason } : {}),
    confidence,
    source,
    requiresReview,
    previousValue,
    ...(choice ? { choice } : {}),
  };
}

export function querySafely(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    return null; // malformed selector
  }
}
