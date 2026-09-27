/**
 * Background service worker — the orchestrator.
 *
 * Flow:
 *   1. User clicks the toolbar icon → we send START_AUTOFILL to the tab's
 *      content script (injecting it first if needed).
 *   2. Content script scans the form and sends CLASSIFY_AND_PLAN with the
 *      extracted FieldCandidates.
 *   3. We ask Jev to classify each field, load the profile, and turn each
 *      classification into a FillInstruction (value + confidence + action).
 *   4. The instructions go back as the sendMessage response; the content
 *      script fills the DOM and shows the confirmation overlay.
 */
import { classifyFields } from './api/jev-client';
import { generateAnswer } from './api/llm-client';
import { getProfile } from './storage/profile-store';
import type {
  CanonicalKey,
  ClassifyAndPlanResponse,
  ExtensionMessage,
  FieldCandidate,
  FillInstruction,
  JevClassification,
  Profile,
} from '../shared/types';

/** Below this confidence we don't touch the field at all. */
const MIN_FILL_CONFIDENCE = 0.5;
/** Below this confidence we fill but flag the field for review. */
const REVIEW_CONFIDENCE = 0.8;

// --- Toolbar click → kick off autofill in the active tab --------------------

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  const message: ExtensionMessage = { type: 'START_AUTOFILL' };

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // No content script in this tab (e.g. it was open before the extension
    // was installed/reloaded). Inject it on demand, then retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (err) {
      console.warn('[bg] cannot run autofill on this page:', err);
    }
  }
});

// --- Messages from the content script ---------------------------------------

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message?.type !== 'CLASSIFY_AND_PLAN') return false;

  buildFillPlan(message.fields)
    .then((instructions): ClassifyAndPlanResponse => ({ ok: true, instructions }))
    .catch((err): ClassifyAndPlanResponse => ({ ok: false, error: String(err?.message ?? err) }))
    .then(sendResponse);

  return true; // keep the message channel open for the async response
});

// Open the profile editor on first install so the user can fill it in.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.runtime.openOptionsPage();
});

// --- Planning ---------------------------------------------------------------

async function buildFillPlan(fields: FieldCandidate[]): Promise<FillInstruction[]> {
  console.log(`[bg] classifying ${fields.length} fields`, fields);

  const [classifications, profile] = await Promise.all([classifyFields(fields), getProfile()]);
  const byId = new Map(classifications.map((c) => [c.fieldId, c]));

  const instructions = await Promise.all(
    fields.map((field) => {
      const c: JevClassification = byId.get(field.fieldId) ?? {
        fieldId: field.fieldId,
        key: 'unknown',
        confidence: 0,
      };
      return planField(field, c, profile);
    }),
  );

  console.log('[bg] fill plan', instructions);
  return instructions;
}

async function planField(
  field: FieldCandidate,
  c: JevClassification,
  profile: Profile,
): Promise<FillInstruction> {
  const base = {
    fieldId: field.fieldId,
    key: c.key,
    confidence: c.confidence,
    needsReview: c.confidence < REVIEW_CONFIDENCE,
  };
  const skip = (reason: string, source: FillInstruction['source'] = 'none'): FillInstruction => ({
    ...base,
    value: '',
    action: 'skip',
    source,
    reason,
  });

  if (c.key === 'unknown') return skip('Unrecognized field');
  if (c.confidence < MIN_FILL_CONFIDENCE) return skip('Confidence too low');

  if (c.key === 'custom_question') {
    // MVP: exercise the LLM path but don't write placeholder text into the page.
    const question = field.label || field.ariaLabel || field.placeholder || field.nearbyText;
    const draft = await generateAnswer(question, profile);
    console.log('[bg] custom question draft (not filled in MVP):', { question, draft });
    return skip('Custom questions not enabled yet', 'llm');
  }

  const value = valueFromProfile(c.key, profile);
  if (!value) return skip('No value in profile');

  return { ...base, value, action: 'fill', source: 'profile' };
}

/** Maps a canonical key to the stored profile value. */
function valueFromProfile(key: CanonicalKey, p: Profile): string {
  switch (key) {
    case 'firstName':
      return p.firstName;
    case 'lastName':
      return p.lastName;
    case 'fullName':
      return [p.firstName, p.lastName].filter(Boolean).join(' ');
    case 'email':
      return p.email;
    case 'phone':
      return p.phone;
    case 'linkedin':
      return p.linkedin;
    case 'resume':
      return p.resumeText;
    default:
      return '';
  }
}
