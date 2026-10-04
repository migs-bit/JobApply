import type { ProfileKey } from './types';

/**
 * Multiple-choice profile answers (EEO self-identification and Yes/No
 * eligibility questions).
 *
 * The profile stores a stable code ("not_veteran"). Dropdown wording varies
 * across forms, even between Lever forms ("I am not a veteran" vs "I am not a
 * protected veteran"), so each code lists the option texts that mean it, in
 * priority order. The filler compares them as whole strings after
 * normalizeOptionText, never as substrings, so "male" can't match "female".
 */
export interface Choice {
  /** Stored in the profile. */
  code: string;
  /** Shown on the options page, and typed into a text box asking the same question. */
  label: string;
  /** Option texts meaning this answer, most specific first. */
  synonyms: readonly string[];
}

const DECLINE: readonly string[] = [
  'Decline to self-identify',
  'I decline to self-identify',
  'Decline to answer',
  "I don't wish to answer",
  'I do not wish to answer',
  'I do not want to answer',
  'Prefer not to say',
  'Prefer not to answer',
  'I prefer not to answer',
  'I prefer not to say',
];

const yesNo = (yes: readonly string[], no: readonly string[]): readonly Choice[] => [
  { code: 'Yes', label: 'Yes', synonyms: ['Yes', ...yes] },
  { code: 'No', label: 'No', synonyms: ['No', ...no] },
];

export const CHOICES: Readonly<Partial<Record<ProfileKey, readonly Choice[]>>> = {
  gender: [
    { code: 'male', label: 'Male', synonyms: ['Male', 'Man', 'M'] },
    { code: 'female', label: 'Female', synonyms: ['Female', 'Woman', 'F'] },
    { code: 'non_binary', label: 'Non-binary', synonyms: ['Non-binary', 'Nonbinary', 'Non-binary / non-conforming'] },
    { code: 'decline', label: 'Decline to self-identify', synonyms: DECLINE },
  ],
  race: [
    { code: 'hispanic', label: 'Hispanic or Latino', synonyms: ['Hispanic or Latino', 'Hispanic or Latinx', 'Hispanic/Latino', 'Hispanic'] },
    { code: 'white', label: 'White', synonyms: ['White (Not Hispanic or Latino)', 'White', 'Caucasian'] },
    {
      code: 'black',
      label: 'Black or African American',
      synonyms: ['Black or African American (Not Hispanic or Latino)', 'Black or African American', 'Black'],
    },
    { code: 'asian', label: 'Asian', synonyms: ['Asian (Not Hispanic or Latino)', 'Asian'] },
    {
      code: 'native_hawaiian',
      label: 'Native Hawaiian or Other Pacific Islander',
      synonyms: ['Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)', 'Native Hawaiian or Other Pacific Islander'],
    },
    {
      code: 'american_indian',
      label: 'American Indian or Alaska Native',
      synonyms: ['American Indian or Alaska Native (Not Hispanic or Latino)', 'American Indian or Alaska Native'],
    },
    { code: 'two_or_more', label: 'Two or more races', synonyms: ['Two or More Races (Not Hispanic or Latino)', 'Two or More Races'] },
    { code: 'decline', label: 'Decline to self-identify', synonyms: DECLINE },
  ],
  veteranStatus: [
    {
      code: 'not_veteran',
      label: 'I am not a protected veteran',
      synonyms: ['I am not a protected veteran', 'I am not a veteran', 'Not a protected veteran', 'Not a veteran', 'No'],
    },
    {
      code: 'protected_veteran',
      label: 'I identify as a protected veteran',
      synonyms: [
        'I identify as one or more of the classifications of protected veteran listed above',
        'I identify as one or more of the classifications of protected veteran',
        'I identify as a protected veteran',
        'I am a protected veteran',
        'Protected veteran',
        'I am a veteran',
        'Yes',
      ],
    },
    {
      code: 'decline',
      label: 'Decline to self-identify',
      synonyms: ['I decline to self-identify for protected veteran status', ...DECLINE],
    },
  ],
  disabilityStatus: [
    {
      code: 'no',
      label: 'No, I do not have a disability',
      synonyms: [
        'No, I do not have a disability and have not had one in the past',
        "No, I don't have a disability and have not had one in the past",
        'No, I do not have a disability',
        "No, I don't have a disability",
        'No',
      ],
    },
    {
      code: 'yes',
      label: 'Yes, I have a disability (or had one)',
      synonyms: [
        'Yes, I have a disability (or previously had a disability)',
        'Yes, I have a disability, or have had one in the past',
        'Yes, I have a disability',
        'Yes',
      ],
    },
    { code: 'decline', label: 'Decline to self-identify', synonyms: DECLINE },
  ],
  workAuthorization: yesNo(
    ['Yes, I am authorized', 'Yes, I am authorized to work', 'I am authorized to work'],
    ['No, I am not authorized', 'No, I am not authorized to work'],
  ),
  requiresSponsorship: yesNo(
    ['Sponsorship required', 'Yes, I require sponsorship', 'Yes, I will require sponsorship'],
    ['No sponsorship required', 'No, I do not require sponsorship', 'No, I will not require sponsorship'],
  ),
  willingToRelocate: yesNo(['Yes, I am willing to relocate'], ['No, I am not willing to relocate']),
};

/** Lowercase; punctuation and symbols become spaces; whitespace collapsed and trimmed. */
export function normalizeOptionText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function isChoiceKey(key: string): key is ProfileKey {
  return Object.hasOwn(CHOICES, key);
}

/** The choice stored under `code` for `key`, if `code` is one of its codes. */
export function choiceFor(key: string, code: string): Choice | undefined {
  return isChoiceKey(key) ? CHOICES[key]?.find((c) => c.code === code) : undefined;
}

/**
 * Maps a value saved by an earlier version (free text such as "I am not a
 * veteran") to its code. Returns undefined when nothing matches exactly.
 */
export function codeForLegacyValue(key: ProfileKey, raw: string): string | undefined {
  const target = normalizeOptionText(raw);
  if (!target) return undefined;
  const matches = (CHOICES[key] ?? []).filter((c) =>
    [c.code, c.label, ...c.synonyms].some((s) => normalizeOptionText(s) === target),
  );
  // Text that fits two answers ("No" could be several) isn't safe to migrate.
  return matches.length === 1 ? matches[0]?.code : undefined;
}
