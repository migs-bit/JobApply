import { CHOICES } from '../shared/choices';
import { LIMITS } from '../shared/constants';
import { sanitizeProfile } from '../shared/profile-validation';
import type { FieldCandidate, LearnedUpdate, Msg, MsgType, ProfileKey } from '../shared/types';

/**
 * Trust boundary for runtime messages. Content scripts run inside pages we
 * don't control, so every message is treated as untrusted input: its shape is
 * checked, strings are bounded, and each message type is only accepted from
 * the kind of sender that legitimately sends it.
 */

const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

/** Which contexts may send each message type. */
const ALLOWED_SENDERS: Record<MsgType, 'extension-page' | 'content-script'> = {
  // The full profile is only ever read/written by our own pages (options, popup).
  GET_PROFILE: 'extension-page',
  SET_PROFILE: 'extension-page',
  RESOLVE_FIELDS: 'content-script',
  // "Teach this" is clicked in the overlay, so it arrives from the content script.
  LEARN_ANSWER: 'content-script',
  LEARN_OPTION: 'content-script',
  // Learned answers are only ever listed or edited by our own options page.
  GET_LEARNED: 'extension-page',
  UPDATE_LEARNED: 'extension-page',
};

export function isAllowedSender(type: MsgType, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false;

  const fromExtensionPage = senderOrigin(sender) === EXTENSION_ORIGIN;

  return ALLOWED_SENDERS[type] === 'extension-page'
    ? fromExtensionPage
    : // Top frame only: the MVP never injects into iframes, so a message from
      // a subframe isn't ours to trust.
      !fromExtensionPage && sender.tab !== undefined && sender.frameId === 0;
}

function senderOrigin(sender: chrome.runtime.MessageSender): string | undefined {
  if (sender.origin) return sender.origin;
  try {
    return sender.url ? new URL(sender.url).origin : undefined;
  } catch {
    return undefined;
  }
}

/** Returns a well-formed Msg, or null if `raw` isn't one. */
export function parseMsg(raw: unknown): Msg | null {
  if (!isRecord(raw)) return null;

  switch (raw.type) {
    case 'GET_PROFILE':
      return { type: 'GET_PROFILE' };
    case 'SET_PROFILE':
      // Validation (email format etc.) happens in profile-store before saving.
      return isRecord(raw.profile) ? { type: 'SET_PROFILE', profile: sanitizeProfile(raw.profile) } : null;
    case 'RESOLVE_FIELDS': {
      if (!Array.isArray(raw.fields) || raw.fields.length > LIMITS.fieldsPerPage) return null;
      const fields = raw.fields.map(parseFieldCandidate);
      return fields.every((f): f is FieldCandidate => f !== null) ? { type: 'RESOLVE_FIELDS', fields } : null;
    }
    case 'LEARN_ANSWER': {
      const question = text(raw.question, LIMITS.fieldTextLength);
      const answer = text(raw.answer, LIMITS.learnedAnswerLength);
      if (question === null || answer === null || (raw.kind !== 'text' && raw.kind !== 'choice')) return null;
      return { type: 'LEARN_ANSWER', question, answer, kind: raw.kind };
    }
    case 'LEARN_OPTION': {
      const optionText = text(raw.optionText, LIMITS.fieldTextLength);
      if (!isChoiceKey(raw.key) || optionText === null) return null;
      return { type: 'LEARN_OPTION', key: raw.key, optionText };
    }
    case 'GET_LEARNED':
      return { type: 'GET_LEARNED' };
    case 'UPDATE_LEARNED': {
      const op = parseLearnedUpdate(raw.op);
      return op ? { type: 'UPDATE_LEARNED', op } : null;
    }
    default:
      return null;
  }
}

/** A string within `max` characters, or null. Over-long input is rejected, not truncated: it isn't ours. */
function text(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

function isChoiceKey(v: unknown): v is ProfileKey {
  return typeof v === 'string' && Object.hasOwn(CHOICES, v);
}

function parseLearnedUpdate(raw: unknown): LearnedUpdate | null {
  if (!isRecord(raw)) return null;
  switch (raw.action) {
    case 'editAnswer': {
      const question = text(raw.question, LIMITS.fieldTextLength);
      const answer = text(raw.answer, LIMITS.learnedAnswerLength);
      return question !== null && answer !== null ? { action: 'editAnswer', question, answer } : null;
    }
    case 'deleteAnswer': {
      const question = text(raw.question, LIMITS.fieldTextLength);
      return question !== null ? { action: 'deleteAnswer', question } : null;
    }
    case 'deleteOption': {
      const optionText = text(raw.optionText, LIMITS.fieldTextLength);
      return isChoiceKey(raw.key) && optionText !== null ? { action: 'deleteOption', key: raw.key, optionText } : null;
    }
    case 'clearAll':
      return { action: 'clearAll' };
    default:
      return null;
  }
}

const TAGS = new Set<FieldCandidate['tag']>(['input', 'textarea', 'select']);

function parseFieldCandidate(raw: unknown): FieldCandidate | null {
  if (!isRecord(raw) || !TAGS.has(raw.tag as FieldCandidate['tag'])) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, LIMITS.fieldTextLength) : '');

  const id = str(raw.id);
  const selector = str(raw.selector);
  if (!id || !selector) return null;

  return {
    id,
    selector,
    tag: raw.tag as FieldCandidate['tag'],
    type: str(raw.type),
    name: str(raw.name),
    autocomplete: str(raw.autocomplete),
    label: str(raw.label),
    placeholder: str(raw.placeholder),
    ariaLabel: str(raw.ariaLabel),
    nearbyText: str(raw.nearbyText),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
