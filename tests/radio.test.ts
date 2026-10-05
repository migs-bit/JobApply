import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFillPlan } from '../src/background/fill-plan';
import { resolveField } from '../src/background/resolver/field-resolver';
import { matchOption } from '../src/content/filler/option-match';
import { groupRadios } from '../src/content/scanner/radio-group';
import { choiceFor, CHOICES } from '../src/shared/choices';
import { EMPTY_PROFILE } from '../src/shared/constants';
import type { FieldCandidate, ProfileKey, ResolvedField } from '../src/shared/types';

const profile = { ...EMPTY_PROFILE };
/** A scanned radio group: the question is in label/nearbyText, the radios' labels in options. */
function group(overrides: Partial<FieldCandidate>): FieldCandidate {
  return {
    id: 'g', selector: '#g', tag: 'input', type: 'radio', name: 'cards[x][field0]', autocomplete: '',
    label: '', placeholder: '', ariaLabel: '', nearbyText: '', options: ['Yes', 'No'], ...overrides,
  };
}
const resolve = (f: Partial<FieldCandidate>): ResolvedField => resolveField(group(f), profile);

describe('group detection (pure grouping)', () => {
  const formA = {}, formB = {};
  it('radios sharing a name in one form are one group', () => {
    const r = [{ name: 'auth', form: formA, v: 'y' }, { name: 'auth', form: formA, v: 'n' }];
    assert.deepEqual(groupRadios(r).map((g) => g.map((x) => x.v)), [['y', 'n']]);
  });
  it('same name in different forms, or outside any form, are different groups', () => {
    const r = [{ name: 'q', form: formA }, { name: 'q', form: formB }, { name: 'q', form: null }, { name: 'q', form: null }];
    assert.deepEqual(groupRadios(r).map((g) => g.length), [1, 1, 2]);
  });
  it('a radio without a name is its own group; groups keep page order', () => {
    const r = [{ name: 'b', form: formA, v: 1 }, { name: '', form: formA, v: 2 }, { name: 'a', form: formA, v: 3 }, { name: 'b', form: formA, v: 4 }];
    assert.deepEqual(groupRadios(r).map((g) => g.map((x) => x.v)), [[1, 4], [2], [3]]);
  });
});

// Question texts from a live Lever posting (WISEcode).
describe('resolution uses the group’s question text, never a radio’s label', () => {
  it('work authorization, sponsorship, and gender questions', () => {
    assert.deepEqual(
      [resolve({ nearbyText: 'Are you legally authorized to work in the United States for any employer? ✱' }).key,
        resolve({ nearbyText: 'Will you now or will you in the future require employment visa sponsorship? ✱' }).key,
        resolve({ nearbyText: 'What gender do you identify as?', options: ['Female', 'Male', 'Non-binary'] }).key],
      ['workAuthorization', 'requiresSponsorship', 'gender'],
    );
  });
  it('a fieldset legend works as the question', () => {
    assert.equal(resolve({ label: 'Are you willing to relocate?' }).key, 'willingToRelocate');
  });
  it('custom Yes/No questions stay unknown, even though their radios say "Yes"/"No"', () => {
    for (const nearbyText of [
      'Have you built a pipeline that called a paid API at scale with a budget you were accountable for? ✱',
      'Have you designed a schema that another team consumed without you in the room? ✱',
      'Smallest team you have shipped a platform with ✱',
    ]) assert.equal(resolve({ nearbyText }).key, 'unknown', nearbyText);
  });
  it('radio option labels alone never resolve a group', () => {
    assert.equal(resolve({ options: ['Yes', 'No'] }).key, 'unknown');
    assert.equal(resolve({ label: 'Yes', options: ['Yes', 'No'] }).key, 'unknown');
  });
});

describe('field-type limits for radio groups', () => {
  it('only multiple-choice keys: never email, phone, salary, country, or names', () => {
    for (const label of ['Email', 'Phone', 'Desired salary', 'Country', 'First name', 'Notice period']) {
      assert.equal(resolve({ label }).key, 'unknown', label);
    }
  });
  it('the multiple-choice keys are allowed', () => {
    const allowed: Array<[string, string]> = [['Gender', 'gender'], ['Race / ethnicity', 'race'], ['Veteran status', 'veteranStatus'], ['Disability status', 'disabilityStatus']];
    for (const [label, key] of allowed) {
      assert.equal(resolve({ label }).key, key, label);
    }
  });
});

describe('answer selection among radio labels (same synonyms and rules as dropdowns)', () => {
  const opts = (...labels: string[]) => labels.map((text) => ({ text, value: text }));
  const pick = (key: ProfileKey, code: string, labels: string[]) => {
    const m = matchOption(opts(...labels), choiceFor(key, code)?.synonyms ?? []);
    return 'reason' in m ? m.reason : m.matched;
  };
  it('yes/no', () => {
    assert.equal(pick('workAuthorization', 'Yes', ['Yes', 'No']), 'Yes');
    assert.equal(pick('requiresSponsorship', 'No', ['Yes', 'No']), 'No');
    assert.equal(pick('requiresSponsorship', 'No', ['Yes, I require sponsorship', 'No, I do not require sponsorship']), 'No, I do not require sponsorship');
  });
  it('multiple choice', () => {
    assert.equal(pick('gender', 'female', ['Female', 'Male', 'Non-binary']), 'Female');
    assert.equal(pick('gender', 'non_binary', ['Female', 'Male', 'Non-binary']), 'Non-binary');
    assert.equal(pick('veteranStatus', 'not_veteran', ['I identify as one or more of the classifications of protected veteran listed above', 'I am not a protected veteran']), 'I am not a protected veteran');
  });
  it('two radios matching one synonym → "multiple matches"', () => {
    assert.equal(pick('workAuthorization', 'Yes', ['Yes', 'yes', 'No']), 'multiple matches');
  });
  it('no radio matching → "no option matched"', () => {
    assert.equal(pick('gender', 'decline', ['Female', 'Male', 'Non-binary']), 'no option matched');
  });
  it('every Yes/No answer code exists for the radio-compatible eligibility keys', () => {
    for (const key of ['workAuthorization', 'requiresSponsorship', 'willingToRelocate'] as const) {
      assert.deepEqual(CHOICES[key]?.map((c) => c.code), ['Yes', 'No']);
    }
  });
});

describe('fill plan for radio groups', () => {
  it('carries the answer’s synonyms and is always flagged for review (sensitive)', () => {
    const plan = buildFillPlan([group({ nearbyText: 'Are you legally authorized to work in the United States? ✱' })], { ...EMPTY_PROFILE, workAuthorization: 'Yes' });
    const i = plan.instructions[0];
    assert.equal(i?.key, 'workAuthorization');
    assert.equal(i?.optionCandidates?.[0], 'Yes');
    assert.equal(i?.requiresReview, true);
  });
});
