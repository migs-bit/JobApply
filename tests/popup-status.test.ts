import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fillStatus } from '../src/popup/status';
import type { FillSummary } from '../src/shared/types';

const summary = (s: Partial<FillSummary>): FillSummary => ({
  fields: 10,
  matched: 5,
  attempted: 5,
  filled: 5,
  needsReview: 0,
  failed: 0,
  teachable: 0,
  overlayShown: false,
  resumeAttached: false,
  resumeMissing: false,
  ...s,
});

describe('fillStatus', () => {
  it('reports filled out of attempted', () => {
    assert.equal(fillStatus(summary({ filled: 4 })), 'Filled 4 of 5 fields.');
    assert.equal(fillStatus(summary({ matched: 1, attempted: 1, filled: 1 })), 'Filled 1 of 1 field.');
  });
  it('adds review and failure counts when present', () => {
    assert.equal(fillStatus(summary({ filled: 4, needsReview: 1, failed: 1 })), "Filled 4 of 5 fields · 1 to review · 1 didn't stick.");
  });
  it('explains why nothing was filled', () => {
    assert.equal(fillStatus(summary({ fields: 0, matched: 0, attempted: 0, filled: 0 })), 'No form fields found on this page.');
    assert.equal(fillStatus(summary({ matched: 0, attempted: 0, filled: 0 })), 'Nothing to fill on this page.');
    assert.equal(fillStatus(summary({ attempted: 0, filled: 0 })), 'Nothing to fill: no saved details for the fields found.');
    assert.equal(fillStatus(summary({ filled: 0 })), 'Nothing to fill: those fields are already filled or hidden.');
  });
  it('never contains anything but counts and fixed wording', () => {
    assert.doesNotMatch(fillStatus(summary({ filled: 3, needsReview: 2 })), /@|https?:/);
  });
});
