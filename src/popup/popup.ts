/**
 * Popup: one button that fills the current tab.
 *
 * Opening the popup is the user gesture that grants activeTab for the current
 * tab, so no host permissions are needed. The popup never requests or holds
 * profile data: the content script gets values from the service worker and
 * reports back counts only. Nothing here logs.
 */
import '../shared/theme.css';
import './popup.css';
import { CONTENT_READY_FLAG } from '../shared/constants';
import type { ContentMsg, FillSummary, MsgResponse } from '../shared/types';
import { fillStatus } from './status';

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const button = document.getElementById('fill') as HTMLButtonElement;

type Outcome = { text: string; kind: 'done' | 'error' };

function show(text: string, kind: '' | Outcome['kind'] = ''): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

/** Injects the content script unless this page already has it (it sets CONTENT_READY_FLAG). */
async function ensureContentScript(tabId: number): Promise<void> {
  const [probe] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (flag: string) => (globalThis as unknown as Record<string, unknown>)[flag] === true,
    args: [CONTENT_READY_FLAG],
  });
  if (probe?.result !== true) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function fillActiveTab(): Promise<Outcome> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return { text: "Couldn't find the current tab.", kind: 'error' };

  try {
    await ensureContentScript(tab.id);
  } catch {
    // chrome:// pages, the Chrome Web Store, PDFs, and similar are off-limits to extensions.
    return { text: "Chrome doesn't let extensions fill this page.", kind: 'error' };
  }

  let res: MsgResponse<FillSummary> | undefined;
  try {
    const msg: ContentMsg = { type: 'FILL_PAGE' };
    res = (await chrome.tabs.sendMessage(tab.id, msg)) as MsgResponse<FillSummary> | undefined;
  } catch {
    res = undefined;
  }
  if (!res?.ok) return { text: 'Something went wrong. Reload the page and try again.', kind: 'error' };
  return { text: fillStatus(res.data), kind: 'done' };
}

button.addEventListener('click', () => {
  button.disabled = true;
  show('Filling…');
  void fillActiveTab()
    .catch((): Outcome => ({ text: 'Something went wrong. Reload the page and try again.', kind: 'error' }))
    .then(({ text, kind }) => {
      show(text, kind);
      button.disabled = false;
    });
});

show('Fills this page with your saved profile. Nothing is submitted.');
button.disabled = false;
