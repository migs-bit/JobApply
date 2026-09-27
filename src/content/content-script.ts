/**
 * Content script entry point.
 *
 * Flow (triggered by START_AUTOFILL from the background when the user clicks
 * the toolbar icon):
 *   1. scanForm()                → FieldCandidate[] from the current page
 *   2. sendMessage(CLASSIFY_AND_PLAN) → background classifies via Jev and
 *                                  returns FillInstruction[]
 *   3. applyFillInstructions()   → writes values into the DOM (React-safe)
 *   4. showConfirmationOverlay() → lists fills + confidence, flags low ones
 */
import { scanForm } from './scanner/dom-scanner';
import { applyFillInstructions } from './filler/dom-filler';
import { showConfirmationOverlay, showToast } from './overlay/confirmation-ui';
import type { ClassifyAndPlanResponse, ExtensionMessage } from '../shared/types';

declare global {
  interface Window {
    __jobApplyAutofillLoaded?: boolean;
  }
}

// The background may inject this script on demand even when the manifest
// already did; only register listeners once per page.
if (!window.__jobApplyAutofillLoaded) {
  window.__jobApplyAutofillLoaded = true;

  let running = false;

  async function runAutofill(): Promise<void> {
    if (running) return;
    running = true;
    try {
      const fields = scanForm(document);
      console.log(`[JobApply] found ${fields.length} fillable fields`, fields);
      if (fields.length === 0) {
        showToast('No fillable fields found on this page.');
        return;
      }

      const message: ExtensionMessage = { type: 'CLASSIFY_AND_PLAN', fields, pageUrl: location.href };
      const response = (await chrome.runtime.sendMessage(message)) as ClassifyAndPlanResponse | undefined;

      if (!response?.ok) {
        const error = response ? response.error : 'No response from background';
        console.error('[JobApply] planning failed:', error);
        showToast(`Autofill failed: ${error}`);
        return;
      }

      const results = applyFillInstructions(response.instructions);
      console.log('[JobApply] fill results', results);
      showConfirmationOverlay(results);
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message?.type !== 'START_AUTOFILL') return false;
    runAutofill()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error('[JobApply] autofill error:', err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  });
}
