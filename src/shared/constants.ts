import type { Profile, ProfileKey } from './types';

/**
 * Canonical profile keys, in display order. `satisfies` makes the compiler
 * reject a key that doesn't exist on Profile; the check below catches the
 * reverse (a Profile key missing from this list).
 */
export const PROFILE_KEYS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'linkedin',
  'github',
  'website',
] as const satisfies readonly ProfileKey[];

type MissingKeys = Exclude<ProfileKey, (typeof PROFILE_KEYS)[number]>;
// If this line errors, a Profile key was added without updating PROFILE_KEYS.
const _allKeysListed: MissingKeys extends never ? true : never = true;
void _allKeysListed;

export const EMPTY_PROFILE: Readonly<Profile> = Object.freeze(
  Object.fromEntries(PROFILE_KEYS.map((k) => [k, ''])) as unknown as Profile,
);

/** Profile keys whose value must be an http(s) URL. */
export const URL_KEYS: ReadonlySet<ProfileKey> = new Set(['linkedin', 'github', 'website']);

export const STORAGE_KEYS = {
  profile: 'profile',
} as const;

/**
 * Hard caps applied at the trust boundary (the service worker). They bound
 * memory/CPU spent on data that originates in an untrusted page or a
 * tampered-with storage area.
 */
export const LIMITS = {
  /** Max characters per profile value. */
  profileValueLength: 500,
  /** Max fields accepted in one RESOLVE_FIELDS message. */
  fieldsPerPage: 500,
  /** Max characters per FieldCandidate string property. */
  fieldTextLength: 300,
  /** Max characters of surrounding text captured per field by the scanner. */
  nearbyTextLength: 200,
} as const;

/** Confidence assigned by each resolver tier (see Brief.md). */
export const CONFIDENCE = {
  autocomplete: 1.0,
  dictionaryStrong: 0.9, // pattern matched `name` or `label`
  dictionaryWeak: 0.7, // pattern matched `placeholder` or `nearbyText`
  fuzzyMinimum: 0.6, // fuzzy matches below this are rejected
} as const;

/** Fills below this confidence are flagged for review in the overlay. */
export const REVIEW_THRESHOLD = 0.8;
