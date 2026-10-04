import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchOption, optionTexts, type OptionLike } from '../src/content/filler/option-match';
import { CHOICES, choiceFor, codeForLegacyValue, normalizeOptionText } from '../src/shared/choices';
import type { ProfileKey } from '../src/shared/types';

const opts = (...texts: string[]): OptionLike[] => [{ text: 'Select ...', value: '' }, ...texts.map((t) => ({ text: t, value: t }))];
const synonyms = (key: ProfileKey, code: string) => choiceFor(key, code)?.synonyms ?? [];
/** Text of the option chosen for `code` among `options`, or the failure reason. */
function pick(key: ProfileKey, code: string, options: OptionLike[]): string {
  const m = matchOption(options, synonyms(key, code));
  return 'reason' in m ? m.reason : m.matched;
}

// Variations listed in prompt.md, as the option text a form might show.
const PROMPT_VARIATIONS: Array<[ProfileKey, string, string[]]> = [
  ['veteranStatus', 'not_veteran', ['I am not a protected veteran', 'Not a protected veteran', 'No']],
  ['veteranStatus', 'protected_veteran', ['I identify as one or more of the classifications of protected veteran', 'Protected veteran']],
  ['veteranStatus', 'decline', ['I decline to self-identify for protected veteran status', 'Decline to self-identify', 'Prefer not to say']],
  ['gender', 'male', ['Male', 'Man', 'M']],
  ['gender', 'female', ['Female', 'Woman', 'F']],
  ['gender', 'decline', ['Decline to self-identify', 'Prefer not to say']],
  ['race', 'white', ['White', 'White (Not Hispanic or Latino)', 'Caucasian']],
  ['race', 'asian', ['Asian', 'Asian (Not Hispanic or Latino)']],
  ['race', 'black', ['Black or African American', 'Black or African American (Not Hispanic or Latino)']],
  ['race', 'decline', ['Decline to self-identify', 'Prefer not to say']],
  ['workAuthorization', 'Yes', ['Yes', 'Yes, I am authorized', 'I am authorized to work']],
  ['workAuthorization', 'No', ['No', 'No, I am not authorized']],
  ['requiresSponsorship', 'No', ['No', 'No sponsorship required']],
  ['requiresSponsorship', 'Yes', ['Yes', 'Sponsorship required', 'Yes, I require sponsorship']],
  ['disabilityStatus', 'decline', ['Decline to self-identify', 'Prefer not to say']],
];

describe('every variation from prompt.md is matched', () => {
  for (const [key, code, variations] of PROMPT_VARIATIONS) {
    for (const text of variations) {
      it(`${key}=${code} selects "${text}"`, () => {
        // The variation sits among the other answers' main wording, as on a real form.
        const others = (CHOICES[key] ?? []).filter((c) => c.code !== code).map((c) => c.synonyms[0] ?? '');
        assert.equal(pick(key, code, opts(...others, text)), text);
      });
    }
  }
});

describe('real dropdowns', () => {
  const leverStandardVeteran = opts('I am a veteran', 'I am not a veteran', 'Decline to self-identify'); // WISEcode, Zoox
  const leverProtectedVeteran = opts(
    'I am not a protected veteran',
    'I identify as one or more of the classifications of protected veteran listed above',
    'I decline to self-identify for protected veteran status',
  );
  it('veteran status works with both Lever wordings', () => {
    assert.equal(pick('veteranStatus', 'not_veteran', leverStandardVeteran), 'I am not a veteran');
    assert.equal(pick('veteranStatus', 'not_veteran', leverProtectedVeteran), 'I am not a protected veteran');
    assert.equal(pick('veteranStatus', 'protected_veteran', leverStandardVeteran), 'I am a veteran');
    assert.equal(
      pick('veteranStatus', 'protected_veteran', leverProtectedVeteran),
      'I identify as one or more of the classifications of protected veteran listed above',
    );
    assert.equal(pick('veteranStatus', 'decline', leverStandardVeteran), 'Decline to self-identify');
    assert.equal(pick('veteranStatus', 'decline', leverProtectedVeteran), 'I decline to self-identify for protected veteran status');
  });
  it('gender and race still fill on Lever’s standard survey (no regression)', () => {
    const gender = opts('Male', 'Female', 'Decline to self-identify');
    assert.equal(pick('gender', 'female', gender), 'Female');
    assert.equal(pick('gender', 'decline', gender), 'Decline to self-identify');
    const race = opts('Hispanic or Latino', 'White (Not Hispanic or Latino)', 'Asian (Not Hispanic or Latino)', 'Two or More Races (Not Hispanic or Latino)', 'Decline to self-identify');
    assert.equal(pick('race', 'asian', race), 'Asian (Not Hispanic or Latino)');
    assert.equal(pick('race', 'two_or_more', race), 'Two or More Races (Not Hispanic or Latino)');
  });
});

describe('normalization and matching rules', () => {
  it('lowercases, trims, collapses whitespace, strips punctuation', () => {
    assert.equal(normalizeOptionText('  Yes,  I am   authorized. '), 'yes i am authorized');
    assert.equal(normalizeOptionText('White (Not Hispanic or Latino);'), 'white not hispanic or latino');
    assert.equal(pick('workAuthorization', 'Yes', opts('No', 'YES, I AM AUTHORIZED!')), 'YES, I AM AUTHORIZED!');
  });
  it('whole-string equality only: "male" never selects "female"', () => {
    assert.equal(pick('gender', 'male', opts('Female', 'Decline to self-identify')), 'no option matched');
    assert.equal(pick('veteranStatus', 'protected_veteran', opts('I am not a protected veteran')), 'no option matched');
  });
  it('matches the option value too, never the placeholder, never a disabled option', () => {
    assert.equal(pick('gender', 'female', [{ text: 'Select', value: '' }, { text: 'Femme', value: 'F' }]), 'Femme');
    assert.equal(pick('gender', 'female', [{ text: 'Female', value: 'f', disabled: true }]), 'no option matched');
  });
  it('the most specific synonym wins when several are present', () => {
    assert.equal(pick('race', 'white', opts('White', 'White (Not Hispanic or Latino)')), 'White (Not Hispanic or Latino)');
  });
  it('two options equal to the same synonym → ambiguous, nothing selected', () => {
    assert.equal(pick('gender', 'female', opts('Female', 'female ')), 'multiple matches');
  });
  it('nothing equal → "no option matched"', () => {
    assert.equal(pick('race', 'asian', opts('Asian American', 'East Asian')), 'no option matched');
  });
  it('diagnostic option list: first 10, trimmed and capped', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ text: ` Option   ${i} `, value: String(i) }));
    const list = optionTexts(many);
    assert.equal(list.length, 10);
    assert.equal(list[3], 'Option 3');
  });
});

describe('choice table integrity', () => {
  it('no option text means two different answers for the same question', () => {
    for (const [key, choices] of Object.entries(CHOICES)) {
      const owner = new Map<string, string>();
      for (const c of choices ?? []) {
        for (const s of new Set(c.synonyms.map(normalizeOptionText))) {
          assert.ok(!owner.has(s) || owner.get(s) === c.code, `${key}: "${s}" belongs to both ${owner.get(s)} and ${c.code}`);
          owner.set(s, c.code);
        }
      }
    }
  });
  it('every synonym of every answer is selectable among the other answers’ wordings', () => {
    for (const [key, choices] of Object.entries(CHOICES) as Array<[ProfileKey, NonNullable<(typeof CHOICES)[ProfileKey]>]>) {
      for (const c of choices) {
        const others = choices.filter((o) => o.code !== c.code).map((o) => o.synonyms[0] ?? '');
        for (const s of c.synonyms) assert.equal(pick(key, c.code, opts(...others, s)), s, `${key}=${c.code} / "${s}"`);
      }
    }
  });
});

describe('legacy values', () => {
  it('free text saved by the previous version maps to its code', () => {
    assert.equal(codeForLegacyValue('veteranStatus', 'I am not a veteran'), 'not_veteran');
    assert.equal(codeForLegacyValue('race', 'Asian (Not Hispanic or Latino)'), 'asian');
    assert.equal(codeForLegacyValue('gender', 'Decline to self-identify'), 'decline');
    assert.equal(codeForLegacyValue('gender', 'something else'), undefined);
  });
});
