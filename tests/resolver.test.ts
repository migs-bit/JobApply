import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_PROFILE } from '../src/shared/constants';
import type { FieldCandidate, ResolvedField } from '../src/shared/types';
import { resolveField } from '../src/background/resolver/field-resolver';
import { tierAutocomplete } from '../src/background/resolver/tier-autocomplete';
import { normalizeForMatching, tierDictionary } from '../src/background/resolver/tier-dictionary';

const profile = { ...EMPTY_PROFILE };

function field(overrides: Partial<FieldCandidate>): FieldCandidate {
  return {
    id: 'f_test',
    selector: '#test',
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
const keyOf = (f: Partial<FieldCandidate>) => resolve(f).key;

describe('Tier 1: autocomplete', () => {
  it('maps standard tokens with full confidence', () => {
    const r = tierAutocomplete(field({ autocomplete: 'given-name' }), profile);
    assert.deepEqual([r?.key, r?.confidence, r?.source], ['firstName', 1, 'autocomplete']);
  });
  it('reads the field token from a token list', () => {
    assert.equal(tierAutocomplete(field({ autocomplete: 'section-apply shipping family-name' }), profile)?.key, 'lastName');
    assert.equal(tierAutocomplete(field({ type: 'email', autocomplete: 'work email webauthn' }), profile)?.key, 'email');
  });
  it('ignores on/off/unknown tokens', () => {
    for (const autocomplete of ['off', 'on', 'nickname', '']) {
      assert.equal(tierAutocomplete(field({ autocomplete }), profile), null, autocomplete);
    }
  });
  it('rejects tokens that conflict with the input type', () => {
    assert.equal(tierAutocomplete(field({ type: 'email', autocomplete: 'tel' }), profile), null);
  });
  it('does not read inherited properties as tokens', () => {
    assert.equal(tierAutocomplete(field({ autocomplete: 'constructor' }), profile), null);
    assert.equal(tierAutocomplete(field({ autocomplete: '__proto__' }), profile), null);
  });
});

describe('Tier 2: dictionary', () => {
  it('label and name matches are strong (0.9)', () => {
    const r = tierDictionary(field({ label: 'First Name ✱' }), profile);
    assert.deepEqual([r?.key, r?.confidence, r?.source], ['firstName', 0.9, 'dictionary']);
    assert.equal(tierDictionary(field({ name: 'last_name' }), profile)?.confidence, 0.9);
  });
  it('placeholder and nearby-text matches are weak (0.7)', () => {
    assert.equal(tierDictionary(field({ placeholder: 'City' }), profile)?.confidence, 0.7);
    assert.equal(tierDictionary(field({ nearbyText: 'Postal code' }), profile)?.confidence, 0.7);
  });
  it('the label outranks a misleading name attribute', () => {
    assert.equal(keyOf({ label: 'GitHub URL', name: 'website' }), 'github');
  });
  it('records evidence that explains the match', () => {
    assert.match(resolve({ label: 'Email' }).evidence, /^label "Email" matched \//);
  });
  it('normalizes separators, casing, camelCase, and required markers', () => {
    assert.equal(normalizeForMatching('firstName'), 'first name');
    assert.equal(normalizeForMatching('urls[LinkedIn]'), 'urls linked in');
    assert.equal(normalizeForMatching('Email (required)'), 'email');
    assert.equal(normalizeForMatching('  Full   name ✱ '), 'full name');
  });
});

describe('real-world field shapes', () => {
  it('Lever standard fields', () => {
    assert.equal(keyOf({ name: 'name', label: 'Full name ✱' }), 'fullName');
    assert.equal(keyOf({ type: 'email', name: 'email', label: 'Email ✱' }), 'email');
    assert.equal(keyOf({ name: 'phone', label: 'Phone' }), 'phone');
    assert.equal(keyOf({ name: 'urls[LinkedIn]', label: 'LinkedIn URL' }), 'linkedin');
    assert.equal(keyOf({ name: 'urls[GitHub]', label: 'GitHub URL' }), 'github');
    assert.equal(keyOf({ name: 'urls[Portfolio]', label: 'Portfolio URL' }), 'website');
    assert.equal(keyOf({ name: 'org', label: 'Current company' }), 'unknown');
  });
  it('Ashby system fields', () => {
    assert.equal(keyOf({ name: '_systemfield_name', label: 'Name' }), 'fullName');
    assert.equal(keyOf({ type: 'email', name: '_systemfield_email', label: 'Email' }), 'email');
    assert.equal(keyOf({ type: 'tel', label: 'Phone' }), 'phone');
    assert.equal(keyOf({ label: 'LinkedIn Profile' }), 'linkedin');
  });
  it('Lever custom questions stay unknown', () => {
    assert.equal(keyOf({ tag: 'textarea', type: '', name: 'cards[x][field0]', nearbyText: 'Why do you want to work at Palantir?' }), 'unknown');
    assert.equal(keyOf({ label: 'Preferred Name | What would you like us to call you?' }), 'unknown');
    assert.equal(keyOf({ label: 'Name Pronunciation | How do you pronounce your name?' }), 'unknown');
  });
});

describe('URL fields', () => {
  it('personal-site wording resolves to website', () => {
    for (const label of ['Website', 'Personal website', 'Web site', 'Portfolio URL', 'Personal URL', 'Personal site', 'Site URL']) {
      assert.equal(keyOf({ label }), 'website', label);
    }
  });
  it('other links fall through to unknown, as text or type="url"', () => {
    for (const label of ['Project URL', 'Replit Profile URL', 'Twitter URL', 'URL', 'Other URL']) {
      assert.equal(keyOf({ label }), 'unknown', label);
      assert.equal(keyOf({ type: 'url', label }), 'unknown', `${label} (type=url)`);
    }
    assert.equal(keyOf({ name: 'urls[Twitter]', label: 'Twitter URL' }), 'unknown');
  });
  it('LinkedIn and GitHub still win over the generic website key', () => {
    assert.equal(keyOf({ label: 'LinkedIn Profile URL' }), 'linkedin');
    assert.equal(keyOf({ type: 'url', label: 'GitHub URL' }), 'github');
    assert.equal(keyOf({ label: 'LinkedIn or personal website' }), 'linkedin');
  });
});

describe('false-positive guards', () => {
  it('whole words only ("excellent" is not "cell")', () => {
    assert.equal(keyOf({ label: 'Describe an excellent result' }), 'unknown');
  });
  it('"United States" is not a state field', () => {
    assert.equal(keyOf({ label: 'Which office in the United States?' }), 'unknown');
  });
  it('long nearby text is treated as a question, not a label', () => {
    assert.equal(keyOf({ nearbyText: 'Please state your salary expectations for this role' }), 'unknown');
  });
  it('someone else’s details are not the applicant’s', () => {
    assert.equal(keyOf({ label: 'Referrer email' }), 'unknown');
    assert.equal(keyOf({ label: 'Emergency contact phone' }), 'unknown');
    assert.equal(keyOf({ label: 'Company website' }), 'unknown');
  });
});

describe('field scope and type compatibility', () => {
  it('never resolves password, checkbox, radio, or file inputs', () => {
    for (const type of ['password', 'checkbox', 'radio', 'file', 'date', 'number']) {
      const r = resolve({ type, label: 'Email' });
      assert.deepEqual([r.key, r.source], ['unknown', 'none'], type);
      assert.match(r.evidence, /not filled by the MVP/);
    }
  });
  it('an input type restricts which keys can match', () => {
    assert.equal(keyOf({ type: 'email', label: 'Phone or email' }), 'email');
    assert.equal(keyOf({ type: 'tel', label: 'Email' }), 'unknown');
    assert.equal(keyOf({ type: 'url', label: 'Personal website' }), 'website');
  });
  it('selects only resolve to country/state; textareas only to street address', () => {
    assert.equal(keyOf({ tag: 'select', type: '', label: 'Country' }), 'country');
    assert.equal(keyOf({ tag: 'select', type: '', label: 'Email' }), 'unknown');
    assert.equal(keyOf({ tag: 'textarea', type: '', label: 'Address' }), 'addressLine1');
    assert.equal(keyOf({ tag: 'textarea', type: '', label: 'State why you applied' }), 'unknown');
  });
  it('unmatched fields report why', () => {
    assert.deepEqual(resolve({ label: 'Favourite colour' }), {
      fieldId: 'f_test',
      key: 'unknown',
      confidence: 0,
      source: 'none',
      evidence: 'no tier matched',
    });
  });
});
