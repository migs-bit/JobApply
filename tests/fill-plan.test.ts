import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFillPlan, profileValue } from '../src/background/fill-plan';
import { EMPTY_PROFILE } from '../src/shared/constants';
import type { FieldCandidate, Profile } from '../src/shared/types';

const profile: Profile = {
  ...EMPTY_PROFILE,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  linkedin: 'https://linkedin.com/in/ada',
};

let n = 0;
function field(overrides: Partial<FieldCandidate>): FieldCandidate {
  n++;
  return {
    id: `f_${n}`,
    selector: `#f${n}`,
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

describe('buildFillPlan', () => {
  const fields = [
    field({ label: 'First name' }),
    field({ type: 'email', label: 'Email' }),
    field({ label: 'Phone' }), // resolves, but no phone saved
    field({ label: 'Why do you want to work here?' }), // unknown
    field({ placeholder: 'LinkedIn' }), // weak match → needs review
    field({ type: 'password', label: 'Email' }), // never filled
  ];
  const plan = buildFillPlan(fields, profile);

  it('resolves every field', () => {
    assert.equal(plan.resolutions.length, fields.length);
  });

  it('creates instructions only for resolved fields with a saved value', () => {
    assert.deepEqual(
      plan.instructions.map((i) => [i.key, i.value]),
      [
        ['firstName', 'Ada'],
        ['email', 'ada@example.com'],
        ['linkedin', 'https://linkedin.com/in/ada'],
      ],
    );
  });

  it('carries the scanner selector and flags low confidence for review', () => {
    const linkedin = plan.instructions.find((i) => i.key === 'linkedin');
    assert.equal(linkedin?.selector, fields[4]?.selector);
    assert.equal(linkedin?.requiresReview, true);
    assert.equal(plan.instructions.find((i) => i.key === 'email')?.requiresReview, false);
  });

  it('never puts profile values in resolutions', () => {
    const serialized = JSON.stringify(plan.resolutions);
    for (const value of Object.values(profile).filter(Boolean)) {
      assert.ok(!serialized.includes(value), `resolutions leaked ${value}`);
    }
  });
});

describe('profileValue', () => {
  it('builds fullName only when both names are saved', () => {
    assert.equal(profileValue('fullName', profile), 'Ada Lovelace');
    assert.equal(profileValue('fullName', { ...profile, lastName: '' }), '');
    assert.equal(profileValue('fullName', { ...profile, firstName: '' }), '');
  });
  it('returns stored values as-is, and empty for unsaved keys', () => {
    assert.equal(profileValue('email', profile), 'ada@example.com');
    assert.equal(profileValue('phone', profile), '');
  });
});
