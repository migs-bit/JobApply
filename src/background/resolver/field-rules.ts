import { URL_KEYS } from '../../shared/constants';
import type { FieldCandidate, Profile, ResolvableKey } from '../../shared/types';

/**
 * Which fields the MVP may fill, and which keys make sense for which kind of
 * field. Tiers use these so a text match can't put, say, a phone number into
 * an `type="email"` input or a profile value into a password box.
 */

/** Text-like input types the MVP fills. Everything else resolves to "unknown". */
const FILLABLE_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'search']);

/** Returns why a field is out of scope for filling, or null if it's in scope. */
export function unfillableReason(field: FieldCandidate): string | null {
  if (field.tag === 'input' && !FILLABLE_INPUT_TYPES.has(field.type)) {
    // Includes password: profile data must never be typed into a password field.
    return `type="${field.type}" is not filled by the MVP`;
  }
  return null;
}

/** Keys allowed for each kind of field, by input type or tag. `null` = any key. */
const COMPATIBLE_KEYS: Readonly<Record<string, ReadonlySet<ResolvableKey> | null>> = {
  email: new Set(['email']),
  tel: new Set(['phone']),
  url: URL_KEYS as ReadonlySet<ResolvableKey>,
  // Dropdowns that hold profile data: location pickers, Yes/No eligibility
  // questions, EEO self-identification, and preference pickers.
  select: new Set([
    'country',
    'state',
    'workAuthorization',
    'requiresSponsorship',
    'willingToRelocate',
    'desiredSalary',
    'noticePeriod',
    'gender',
    'race',
    'veteranStatus',
    'disabilityStatus',
  ]),
  // A multi-line box is only ever a profile field when it's a street address.
  textarea: new Set(['addressLine1']),
  text: null,
  search: null,
};

export function isCompatible(field: FieldCandidate, key: ResolvableKey): boolean {
  const kind = field.tag === 'input' ? field.type : field.tag;
  const allowed = COMPATIBLE_KEYS[kind];
  return allowed === null || (allowed !== undefined && allowed.has(key));
}

/**
 * True if the profile schema has what `key` needs. The Profile type is meant
 * to be extended; a resolver key with no backing field counts as no match.
 * (Whether the user has filled the value in is the filler's concern.)
 */
export function canResolve(profile: Profile, key: ResolvableKey): boolean {
  if (key === 'fullName') return Object.hasOwn(profile, 'firstName') && Object.hasOwn(profile, 'lastName');
  return Object.hasOwn(profile, key);
}
