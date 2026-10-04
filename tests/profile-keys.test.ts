import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFillPlan } from '../src/background/fill-plan';
import { resolveField } from '../src/background/resolver/field-resolver';
import { EMPTY_PROFILE } from '../src/shared/constants';
import { sanitizeProfile, validateProfile } from '../src/shared/profile-validation';
import type { FieldCandidate, Profile, ResolvedField } from '../src/shared/types';

const profile = { ...EMPTY_PROFILE };
function field(overrides: Partial<FieldCandidate>): FieldCandidate {
  return {
    id: 'f_keys', selector: '#keys', tag: 'input', type: 'text', name: '', autocomplete: '',
    label: '', placeholder: '', ariaLabel: '', nearbyText: '', ...overrides,
  };
}
const resolve = (f: Partial<FieldCandidate>): ResolvedField => resolveField(field(f), profile);
const select = (f: Partial<FieldCandidate>) => resolve({ tag: 'select', type: '', ...f });

// Lever's real card question (Zoox posting): a Yes/No <select> whose question is only in nearby text.
const LEVER_SPONSORSHIP =
  'Sponsorship: Do you require sponsorship, or will you require sponsorship in the future for employment authorization in the United States? ✱';

describe('EEO keys (Lever eeo[...] selects and labels)', () => {
  it('resolve from Lever’s select names and plain labels', () => {
    assert.equal(select({ name: 'eeo[gender]', label: 'Gender' }).key, 'gender');
    assert.equal(select({ name: 'eeo[race]' }).key, 'race');
    assert.equal(select({ name: 'eeo[veteran]', label: 'Veteran status' }).key, 'veteranStatus');
    assert.equal(select({ label: 'Disability Status' }).key, 'disabilityStatus');
    assert.equal(select({ label: 'Ethnicity' }).key, 'race');
    assert.equal(select({ autocomplete: 'sex' }).key, 'gender');
  });
  it('never match from prose (an intro paragraph mentioning several EEO topics)', () => {
    const intro = 'We invite applicants to share their gender, race, veteran and disability status. This is voluntary.';
    assert.equal(select({ nearbyText: intro }).key, 'unknown');
    assert.equal(resolve({ nearbyText: 'Tell us about your experience with disability inclusion programs' }).key, 'unknown');
  });
  it('an interview-accommodation question is not disability status', () => {
    assert.equal(select({ label: 'Do you need an accommodation for a disability during interviews?' }).key, 'unknown');
  });
});

describe('work eligibility (polarity matters)', () => {
  it('Lever sponsorship card: question text only in nearby text → requiresSponsorship', () => {
    const r = select({ name: 'cards[c62ec44a-0482][field2]', nearbyText: LEVER_SPONSORSHIP });
    assert.deepEqual([r.key, r.confidence], ['requiresSponsorship', 0.7]);
  });
  it('authorization questions', () => {
    assert.equal(select({ label: 'Are you legally authorized to work in the country you’re applying for?' }).key, 'workAuthorization');
    assert.equal(select({ label: 'Work authorization' }).key, 'workAuthorization');
    assert.equal(select({ nearbyText: 'Are you currently eligible to work in the United States? ✱' }).key, 'workAuthorization');
  });
  it('mixed wording that could flip the answer resolves to neither', () => {
    for (const label of [
      'Are you legally authorized to work in the US without the need for visa sponsorship?',
      'Are you authorized to work here without sponsorship?',
    ]) {
      assert.equal(select({ label }).key, 'unknown', label);
      assert.equal(select({ nearbyText: label }).key, 'unknown', `${label} (nearby)`);
    }
  });
  it('relocation: willingness yes, assistance no', () => {
    assert.equal(select({ label: 'Are you willing to relocate?' }).key, 'willingToRelocate');
    assert.equal(select({ nearbyText: 'Would you be willing to relocate to another city for this role?' }).key, 'willingToRelocate');
    assert.equal(select({ label: 'Will you require relocation assistance?' }).key, 'unknown');
  });
  it('prose that fits two question keys is ambiguous', () => {
    assert.equal(select({ nearbyText: 'Are you willing to relocate, and will you require sponsorship for this role?' }).key, 'unknown');
  });
  it('question keys beat the address words inside them', () => {
    assert.equal(select({ label: 'Are you legally authorized to work in this country?' }).key, 'workAuthorization');
    assert.equal(select({ label: 'Country of citizenship' }).key, 'unknown');
    assert.equal(select({ label: 'Country' }).key, 'country');
  });
});

describe('salary and notice period', () => {
  it('desired salary, not current salary', () => {
    assert.equal(resolve({ label: 'Desired salary' }).key, 'desiredSalary');
    assert.equal(resolve({ label: 'Salary' }).key, 'desiredSalary');
    assert.equal(resolve({ nearbyText: 'What are your salary expectations for this role? ✱' }).key, 'desiredSalary');
    assert.equal(resolve({ label: 'Current salary' }).key, 'unknown');
    assert.equal(resolve({ label: 'What is your current base salary and your salary expectations?' }).key, 'unknown');
  });
  it('question keys may mention an employer; ordinary keys still may not', () => {
    assert.equal(resolve({ label: 'Reference phone' }).key, 'unknown');
    assert.equal(resolve({ label: 'Employer email' }).key, 'unknown');
  });
  it('notice period, not a privacy notice', () => {
    assert.equal(resolve({ label: 'Notice period' }).key, 'noticePeriod');
    assert.equal(resolve({ nearbyText: 'How much notice do you need to give your current employer?' }).key, 'noticePeriod');
    assert.equal(resolve({ nearbyText: 'How many weeks of notice do you need to give before starting?' }).key, 'noticePeriod');
    assert.equal(resolve({ label: 'I have read the privacy notice' }).key, 'unknown');
  });
});

describe('fill plan: sensitive answers always need review', () => {
  const saved: Profile = {
    ...EMPTY_PROFILE, gender: 'decline', requiresSponsorship: 'No', desiredSalary: '120,000 USD',
    noticePeriod: '2 weeks', email: 'ada@example.com',
  };
  const plan = buildFillPlan(
    [
      field({ id: 'g', tag: 'select', type: '', name: 'eeo[gender]', label: 'Gender' }),
      field({ id: 's', tag: 'select', type: '', name: 'cards[x][field2]', nearbyText: LEVER_SPONSORSHIP }),
      field({ id: 'pay', label: 'Desired salary' }),
      field({ id: 'np', label: 'Notice period' }),
      field({ id: 'em', type: 'email', label: 'Email' }),
    ],
    saved,
  );
  const review = Object.fromEntries(plan.instructions.map((i) => [i.fieldId, i.requiresReview]));
  it('EEO, eligibility, and salary are flagged even at 0.9; ordinary keys follow confidence', () => {
    assert.deepEqual(review, { g: true, s: true, pay: true, np: false, em: false });
  });
  it('choice codes become a label plus the option wordings that mean them', () => {
    const g = plan.instructions.find((i) => i.fieldId === 'g');
    assert.equal(g?.value, 'Decline to self-identify');
    assert.ok(g?.optionCandidates?.includes('Prefer not to say'));
    assert.equal(plan.instructions.find((i) => i.fieldId === 's')?.optionCandidates?.[0], 'No');
    assert.equal(plan.instructions.find((i) => i.fieldId === 'pay')?.optionCandidates, undefined);
  });
});

describe('profile validation for the new keys', () => {
  it('choice keys accept only their codes, or empty', () => {
    assert.deepEqual(validateProfile(sanitizeProfile({ workAuthorization: 'Yes', requiresSponsorship: 'No', veteranStatus: 'not_veteran' })), {});
    assert.ok(validateProfile(sanitizeProfile({ willingToRelocate: 'maybe' })).willingToRelocate);
    assert.ok(validateProfile(sanitizeProfile({ gender: 'robot' })).gender);
  });
  it('values saved by the previous version (option text) migrate to codes when sanitized', () => {
    const p = sanitizeProfile({ race: '  Asian (Not Hispanic or Latino)\u202E ', veteranStatus: 'I am not a veteran', noticePeriod: 42 });
    assert.equal(p.race, 'asian');
    assert.equal(p.veteranStatus, 'not_veteran');
    assert.equal(p.noticePeriod, '');
  });
});
