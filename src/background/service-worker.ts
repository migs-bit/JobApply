/**
 * Service worker: owns storage, routes messages, and runs the field resolver.
 * RESOLVE_FIELDS returns only keys/confidence/evidence, never profile values:
 * content scripts live in untrusted pages and get values only when filling.
 *
 * There is deliberately no network code anywhere in the extension. The CSP in
 * manifest.json (`default-src 'none'`) blocks fetch/XHR from extension
 * contexts as a backstop.
 */
import { isAllowedSender, parseMsg } from './message-guard';
import { resolveFields } from './resolver/field-resolver';
import { getProfile, restrictStorageToTrustedContexts, saveProfile } from './storage/profile-store';
import { debug } from '../shared/log';
import type { Msg, MsgResponse } from '../shared/types';

// Runs on every service-worker start, before any message is handled.
void restrictStorageToTrustedContexts();

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
});

// TEMPORARY (step 5 testing): clicking the toolbar icon injects the scanner
// into the current tab. The click is the user gesture that grants activeTab,
// so no host permissions are needed. Chrome stops firing onClicked once
// action.default_popup is set, so the step 8 popup replaces this; delete it then.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    // e.g. chrome:// pages and the Web Store, where extensions can't run.
    .catch((err: unknown) => console.error('Could not scan this page', err));
});

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const msg = parseMsg(raw);
  if (!msg) {
    sendResponse(fail('Malformed message'));
    return false;
  }
  if (!isAllowedSender(msg.type, sender)) {
    // Generic error: don't tell an untrusted caller what it would need to change.
    sendResponse(fail('Not allowed'));
    return false;
  }

  debug('message', msg.type);
  handle(msg)
    .then(sendResponse)
    .catch((err: unknown) => {
      console.error(`Error handling ${msg.type}`, err);
      sendResponse(fail('Internal error'));
    });
  return true; // keep the channel open for the async response
});

async function handle(msg: Msg): Promise<MsgResponse<unknown>> {
  switch (msg.type) {
    case 'GET_PROFILE':
      return { ok: true, data: await getProfile() };

    case 'SET_PROFILE': {
      const result = await saveProfile(msg.profile);
      return result.saved
        ? { ok: true, data: result.profile }
        : { ok: false, error: 'Invalid profile', fieldErrors: result.errors };
    }

    case 'RESOLVE_FIELDS':
      return { ok: true, data: resolveFields(msg.fields, await getProfile()) };
  }
}

function fail(error: string): MsgResponse<never> {
  return { ok: false, error };
}
