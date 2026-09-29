import { STORAGE_KEYS } from '../../shared/constants';
import { sanitizeProfile, validateProfile } from '../../shared/profile-validation';
import type { Profile, ProfileErrors } from '../../shared/types';

/**
 * The only module that touches chrome.storage. Everything else goes through
 * the service worker's message router, so there is exactly one writer and
 * one place where input is validated.
 */

/**
 * By default chrome.storage.local is readable from content scripts, which run
 * inside arbitrary (untrusted) web pages. Content scripts never need the full
 * profile. They receive only the values being filled, so lock storage to
 * extension pages + the service worker.
 */
export async function restrictStorageToTrustedContexts(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch (err) {
    // Older Chrome without support for this on storage.local: still safe for
    // the MVP (no content script reads storage), so don't block startup.
    console.error('Could not restrict storage access level', err);
  }
}

export async function getProfile(): Promise<Profile> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.profile);
  // Sanitize on read too: storage may hold data from an older version.
  return sanitizeProfile(stored[STORAGE_KEYS.profile]);
}

export type SaveResult = { saved: true; profile: Profile } | { saved: false; errors: ProfileErrors };

export async function saveProfile(input: unknown): Promise<SaveResult> {
  const profile = sanitizeProfile(input);
  const errors = validateProfile(profile);
  if (Object.keys(errors).length > 0) return { saved: false, errors };

  await chrome.storage.local.set({ [STORAGE_KEYS.profile]: profile });
  return { saved: true, profile };
}
