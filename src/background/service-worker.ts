/**
 * Service worker: owns storage, routes messages, and runs the field resolver.
 * RESOLVE_FIELDS returns a fill plan: value-free resolutions for every field,
 * plus profile values only for fields that resolved and have something saved.
 * Content scripts live in untrusted pages, so they never see the rest.
 *
 * There is deliberately no network code anywhere in the extension. The CSP in
 * manifest.json (`default-src 'none'`) blocks fetch/XHR from extension
 * contexts as a backstop.
 */
import { buildFillPlan } from './fill-plan';
import { isAllowedSender, parseMsg } from './message-guard';
import {
  deleteAnswer, deleteOption, editAnswer, EMPTY_LEARNED, getLearned, learnAnswer, learnOption, saveLearned, type LearnedStore,
  type LearnResult,
} from './storage/learned-store';
import { getProfile, restrictStorageToTrustedContexts, saveProfile } from './storage/profile-store';
import { debug } from '../shared/log';
import type { Msg, MsgResponse } from '../shared/types';

// Runs on every service-worker start, before any message is handled.
void restrictStorageToTrustedContexts();

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
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

    case 'RESOLVE_FIELDS': {
      const [profile, learned] = await Promise.all([getProfile(), getLearned()]);
      return { ok: true, data: buildFillPlan(msg.fields, profile, learned) };
    }

    // Case 1: an unknown field's question → the answer the user gave on the page.
    case 'LEARN_ANSWER':
      return withoutStore(await updateLearned((store) => learnAnswer(store, msg.question, msg.answer, msg.kind)));

    // Case 2: this option text means the user's saved answer for a choice key.
    case 'LEARN_OPTION': {
      const code = (await getProfile())[msg.key];
      return withoutStore(await updateLearned((store) => learnOption(store, msg.key, msg.optionText, code)));
    }

    case 'GET_LEARNED':
      return { ok: true, data: await getLearned() };

    case 'UPDATE_LEARNED': {
      const { op } = msg;
      return updateLearned((store): LearnResult => {
        switch (op.action) {
          case 'editAnswer':
            return editAnswer(store, op.question, op.answer);
          case 'deleteAnswer':
            return { ok: true, store: deleteAnswer(store, op.question), message: 'Deleted.' };
          case 'deleteOption':
            return { ok: true, store: deleteOption(store, op.key, op.optionText), message: 'Deleted.' };
          case 'clearAll':
            return { ok: true, store: EMPTY_LEARNED, message: 'All learned answers deleted.' };
        }
      });
    }
  }
}

/**
 * Read-modify-write of the learned store, one at a time, so two quick
 * "Teach this" clicks can't overwrite each other.
 */
let learnedQueue: Promise<unknown> = Promise.resolve();
function updateLearned(change: (store: LearnedStore) => LearnResult): Promise<MsgResponse<{ message: string; store: LearnedStore }>> {
  const run = learnedQueue.then(async (): Promise<MsgResponse<{ message: string; store: LearnedStore }>> => {
    const result = change(await getLearned());
    if (!result.ok) return { ok: false, error: result.error };
    await saveLearned(result.store);
    return { ok: true, data: { message: result.message, store: result.store } };
  });
  learnedQueue = run.catch(() => {});
  return run;
}

/**
 * Replies to "Teach this" go to a content script inside the web page: send the
 * confirmation only, never the store, which holds every answer the user taught.
 */
function withoutStore(res: MsgResponse<{ message: string; store: LearnedStore }>): MsgResponse<{ message: string }> {
  return res.ok ? { ok: true, data: { message: res.data.message } } : res;
}

function fail(error: string): MsgResponse<never> {
  return { ok: false, error };
}
