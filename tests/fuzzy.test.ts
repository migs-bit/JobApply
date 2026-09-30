import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFillPlan } from '../src/background/fill-plan';
import { resolveField } from '../src/background/resolver/field-resolver';
import { fuzzyTokens, jaccard, tierFuzzy } from '../src/background/resolver/tier-fuzzy';
import { CONFIDENCE, EMPTY_PROFILE, REVIEW_THRESHOLD } from '../src/shared/constants';
import type { FieldCandidate, ResolvedField } from '../src/shared/types';

const profile = { ...EMPTY_PROFILE };

function field(overrides: Partial<FieldCandidate>): FieldCandidate {
  return {
    id: 'f_fuzzy',
    selector: '#fuzzy',
    tag: 'input',
    type: 'text',
    name: '',
    autocomplete: '',
    label: '',
    placeholder: '',
    ariaLabel: '',
    nearbyText: '',
    ...overrides,
  };
}
const resolve = (f: Partial<FieldCandidate>): ResolvedField => resolveField(field(f), profile);

describe('Tier 3: positive matches (only after Tiers 1-2 miss)', () => {
  it('"What should we call you?" → a name key', () => {
    const r = resolve({ label: 'What should we call you?' });
    assert.ok(r.key === 'firstName' || r.key === 'fullName', r.key);
    assert.equal(r.source, 'fuzzy');
  });
  it('"Best number to reach you" → phone', () => {
    const r = resolve({ label: 'Best number to reach you' });
    assert.deepEqual([r.key, r.source], ['phone', 'fuzzy']);
  });
  it('"Electronic mail address" → email', () => {
    const r = resolve({ label: 'Electronic mail address' });
    assert.deepEqual([r.key, r.source], ['email', 'fuzzy']);
  });
  it('works from placeholder, aria-label, and name too', () => {
    assert.equal(resolve({ placeholder: 'Best number to reach you' }).key, 'phone');
    assert.equal(resolve({ ariaLabel: 'Electronic mail address' }).key, 'email');
    assert.equal(resolve({ name: 'residentialAddress' }).key, 'addressLine1');
  });
  it('a noisy name attribute does not dilute a clean label', () => {
    assert.equal(resolve({ label: 'Best number to reach you', name: 'cards[3f9c0e12-aa][field0]' }).key, 'phone');
  });
});

describe('Tier 3: confidence and evidence', () => {
  it('confidence is capped at 0.6, always below a dictionary match, and flagged for review', () => {
    for (const label of ['What should we call you?', 'Best number to reach you', 'Electronic mail address']) {
      const r = resolve({ label });
      assert.ok(r.confidence <= CONFIDENCE.fuzzyMaximum && r.confidence < CONFIDENCE.dictionaryWeak, `${label}: ${r.confidence}`);
      assert.ok(r.confidence < REVIEW_THRESHOLD);
    }
  });
  it('fuzzy fills go through requiresReview in the fill plan', () => {
    const plan = buildFillPlan([field({ label: 'Best number to reach you' })], { ...profile, phone: '+1 555 0100' });
    assert.equal(plan.instructions[0]?.source, 'fuzzy');
    assert.equal(plan.instructions[0]?.requiresReview, true);
  });
  it('evidence says fuzzy, which phrase matched, and the score', () => {
    const r = resolve({ label: 'Best number to reach you' });
    assert.equal(r.evidence, 'label "Best number to reach you" fuzzy-matched "number to reach you" → phone (score 1.00)');
  });
  it('a dictionary hit still wins and is reported as dictionary', () => {
    const r = resolve({ label: 'Email address' });
    assert.deepEqual([r.key, r.source, r.confidence], ['email', 'dictionary', 0.9]);
  });
});

describe('Tier 3: stays unknown when it should', () => {
  it('someone else’s details', () => {
    assert.equal(resolve({ label: 'Referrer email' }).key, 'unknown');
    assert.equal(resolve({ label: 'Company website' }).key, 'unknown');
  });
  it('long question text does not match "state"', () => {
    assert.equal(resolve({ label: 'Please state your salary expectations' }).key, 'unknown');
  });
  it('"Excellent communication skills?" matches nothing (no "cell" substring matching)', () => {
    assert.equal(resolve({ label: 'Excellent communication skills?' }).key, 'unknown');
  });
  it('custom questions below the threshold stay unknown', () => {
    for (const label of ['Why do you want to work here?', 'Name Pronunciation | How do you pronounce your name?', 'Project URL', 'Twitter URL']) {
      const r = resolve({ label });
      assert.deepEqual([r.key, r.source], ['unknown', 'none'], label);
    }
  });
  it('below-threshold similarity is rejected', () => {
    // {mobile, device, preference} vs "mobile number" {mobile, number} → 0.25
    assert.equal(tierFuzzy(field({ label: 'Mobile device preferences' }), profile), null);
  });
});

describe('Tier 3: field-type limits still apply', () => {
  it('an email input can only be email; a select only country/state', () => {
    assert.equal(resolve({ type: 'email', label: 'Best number to reach you' }).key, 'unknown');
    assert.equal(resolve({ type: 'email', label: 'Electronic mail address' }).key, 'email');
    assert.equal(resolve({ tag: 'select', type: '', label: 'Nation' }).key, 'country');
    assert.equal(resolve({ tag: 'select', type: '', label: 'Best number to reach you' }).key, 'unknown');
  });
  it('never matches password, checkbox, radio, or file inputs', () => {
    for (const type of ['password', 'checkbox', 'radio', 'file']) {
      assert.equal(resolve({ type, label: 'Electronic mail address' }).key, 'unknown', type);
    }
  });
});

describe('token helpers', () => {
  it('drops stopwords, digits, and folds plurals', () => {
    assert.deepEqual([...fuzzyTokens('What should we call you?')], ['call']);
    assert.deepEqual([...fuzzyTokens('cards[3f9c][field0] numbers')], ['card', 'number']);
  });
  it('jaccard', () => {
    assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
    assert.equal(jaccard(new Set(), new Set(['a'])), 0);
  });
});
