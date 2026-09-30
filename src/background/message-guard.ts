import { LIMITS } from '../shared/constants';
import { sanitizeProfile } from '../shared/profile-validation';
import type { FieldCandidate, Msg, MsgType } from '../shared/types';

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
