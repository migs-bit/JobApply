import type { Msg, MsgResponse } from './types';

/**
 * Sends a message to the service worker. Always resolves to a MsgResponse:
 * a missing reply or a dead worker becomes { ok: false }, so callers only
 * need one error path.
 */
export async function sendToBackground<T>(msg: Msg): Promise<MsgResponse<T>> {
  try {
    const res = (await chrome.runtime.sendMessage(msg)) as MsgResponse<T> | undefined;
    return res ?? { ok: false, error: 'No response from background' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
