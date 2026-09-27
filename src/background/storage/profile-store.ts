import { EMPTY_PROFILE, type Profile } from '../../shared/types';

/**
 * Profile persistence in chrome.storage.local.
 * Used by both the service worker (read) and the options page (read/write).
 */
const PROFILE_KEY = 'profile';

export async function getProfile(): Promise<Profile> {
  const stored = await chrome.storage.local.get(PROFILE_KEY);
  // Merge over defaults so newly added fields are never undefined.
  return { ...EMPTY_PROFILE, ...((stored[PROFILE_KEY] as Partial<Profile> | undefined) ?? {}) };
}

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}
