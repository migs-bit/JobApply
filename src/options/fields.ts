import type { ProfileKey } from '../shared/types';

/** One input on the options page. */
export interface FieldSpec {
  key: ProfileKey;
  label: string;
  /** `choice` renders a dropdown of the key's answers from shared/choices.ts. */
  kind?: 'text' | 'email' | 'tel' | 'url' | 'choice';
  /** Lets Chrome's own autofill help fill in this form. Sensitive fields use "off". */
  autoComplete?: string;
  placeholder?: string;
  wide?: boolean;
}

export interface SectionSpec {
  title: string;
  note?: string;
  fields: FieldSpec[];
}

export const SECTIONS: readonly SectionSpec[] = [
  {
    title: 'Personal',
    fields: [
      { key: 'firstName', label: 'First name', autoComplete: 'given-name' },
      { key: 'lastName', label: 'Last name', autoComplete: 'family-name' },
      { key: 'email', label: 'Email', kind: 'email', autoComplete: 'email' },
      { key: 'phone', label: 'Phone', kind: 'tel', autoComplete: 'tel' },
    ],
  },
  {
    title: 'Address',
    fields: [
      { key: 'addressLine1', label: 'Address line 1', autoComplete: 'address-line1', wide: true },
      { key: 'addressLine2', label: 'Address line 2', autoComplete: 'address-line2', wide: true },
      { key: 'city', label: 'City', autoComplete: 'address-level2' },
      { key: 'state', label: 'State / province', autoComplete: 'address-level1' },
      { key: 'postalCode', label: 'Postal code', autoComplete: 'postal-code' },
      { key: 'country', label: 'Country', autoComplete: 'country-name' },
    ],
  },
  {
    title: 'Links',
    fields: [
      { key: 'linkedin', label: 'LinkedIn', kind: 'url', autoComplete: 'off', placeholder: 'https://', wide: true },
      { key: 'github', label: 'GitHub', kind: 'url', autoComplete: 'off', placeholder: 'https://', wide: true },
      { key: 'website', label: 'Website / portfolio', kind: 'url', autoComplete: 'url', placeholder: 'https://', wide: true },
    ],
  },
  {
    title: 'Job preferences',
    note: 'Salary answers are always flagged for your review before you submit.',
    fields: [
      { key: 'desiredSalary', label: 'Desired salary', autoComplete: 'off', placeholder: 'e.g. 120,000 USD' },
      { key: 'noticePeriod', label: 'Notice period', autoComplete: 'off', placeholder: 'e.g. 2 weeks' },
    ],
  },
  {
    title: 'Work eligibility',
    note:
      'Used for Yes/No dropdowns, and always flagged for review. A question that mixes both, like ' +
      '"authorized to work without sponsorship?", is left for you, because the right answer flips.',
    fields: [
      { key: 'workAuthorization', label: 'Authorized to work where you apply?', kind: 'choice' },
      { key: 'requiresSponsorship', label: 'Need visa sponsorship, now or later?', kind: 'choice' },
      { key: 'willingToRelocate', label: 'Willing to relocate?', kind: 'choice' },
    ],
  },
  {
    title: 'Voluntary self-identification',
    note:
      'Optional. Only used for voluntary EEO questions; leave blank to skip them. Forms word these options ' +
      'differently, so your answer is matched against common wordings, and a dropdown is skipped if none fits. ' +
      'These answers are always flagged for your review before you submit.',
    fields: [
      { key: 'gender', label: 'Gender', kind: 'choice' },
      { key: 'race', label: 'Race / ethnicity', kind: 'choice' },
      { key: 'veteranStatus', label: 'Veteran status', kind: 'choice' },
      { key: 'disabilityStatus', label: 'Disability status', kind: 'choice' },
    ],
  },
];
