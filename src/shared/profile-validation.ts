import { CHOICES, choiceFor, codeForLegacyValue, isChoiceKey } from './choices';
import { EMPTY_PROFILE, LIMITS, PROFILE_KEYS, URL_KEYS } from './constants';
import type { Profile, ProfileErrors } from './types';

/**
 * Profile sanitizing + validation. Shared so the options page can show errors
 * as you type, but the service worker re-runs it on every write: the UI check
 * is for UX, the background check is the one that counts.
 */

// Control characters have no business in single-line form values, and bidi
// overrides can make a value display differently from what gets typed.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * Coerces untrusted input into a well-formed Profile: only known keys, only
 * strings, no control characters, bounded length. Never throws.
 */
export function sanitizeProfile(input: unknown): Profile {
  const profile: Profile = { ...EMPTY_PROFILE };
  if (typeof input !== 'object' || input === null) return profile;

  for (const key of PROFILE_KEYS) {
    // Own properties only, so nothing is read through the prototype chain.
    const raw: unknown = Object.hasOwn(input, key) ? (input as Record<string, unknown>)[key] : '';
    if (typeof raw !== 'string') continue;

    let value = raw.normalize('NFC').replace(UNSAFE_CHARS, ' ').trim().slice(0, LIMITS.profileValueLength);
    if (URL_KEYS.has(key)) value = withDefaultScheme(value);
    // Earlier versions saved the option text itself; map it to its choice code.
    if (value && isChoiceKey(key) && !choiceFor(key, value)) value = codeForLegacyValue(key, value) ?? value;
    profile[key] = value;
  }
  return profile;
}

/** Returns per-field errors; an empty object means the profile is valid. Empty fields are allowed. */
export function validateProfile(p: Profile): ProfileErrors {
  const errors: ProfileErrors = {};

  if (p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (p.phone && !/^\+?[\d\s().-]{5,}(\s*(x|ext\.?)\s*\d+)?$/i.test(p.phone)) {
    errors.phone = 'Use digits, spaces, and + ( ) - . only.';
  }
  for (const key of URL_KEYS) {
    if (p[key] && !isHttpUrl(p[key])) errors[key] = 'Enter a web address starting with https://';
  }
  for (const key of Object.keys(CHOICES) as Array<keyof typeof CHOICES>) {
    if (p[key] && !choiceFor(key, p[key])) errors[key] = 'Choose one of the options, or leave it blank.';
  }
  return errors;
}

/** "linkedin.com/in/me" → "https://linkedin.com/in/me"; values that already have a scheme are untouched. */
function withDefaultScheme(value: string): string {
  if (!value || /^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

/** Rejects javascript:, data:, file:, etc. Only http(s) with a dotted hostname passes. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}
