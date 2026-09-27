/**
 * Types shared by the content script, service worker, and options page.
 */

/** Canonical keys Jev can assign to a form field. */
export const CANONICAL_KEYS = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'linkedin',
  'resume',
  'custom_question',
  'unknown',
] as const;

export type CanonicalKey = (typeof CANONICAL_KEYS)[number];

/** Metadata about one fillable element, extracted by the DOM scanner. */
export interface FieldCandidate {
  /** Stable ID we stamp onto the element (data-jobapply-id) so the filler can find it again. */
  fieldId: string;
  tagName: 'input' | 'textarea' | 'select';
  /** The input `type` attribute ("text", "email", "tel", ...); empty for textarea/select. */
  inputType: string;
  id: string;
  name: string;
  label: string;
  placeholder: string;
  ariaLabel: string;
  autocomplete: string;
  /** Short snippet of surrounding text (section headings, helper text, etc.). */
  nearbyText: string;
  required: boolean;
  /** Visible option labels, for <select> elements only. */
  options?: string[];
}

/** One classification result from Jev. */
export interface JevClassification {
  fieldId: string;
  key: CanonicalKey;
  /** 0..1 */
  confidence: number;
}

/** What the background tells the content script to do with one field. */
export interface FillInstruction {
  fieldId: string;
  key: CanonicalKey;
  /** Value to write; empty when action is "skip". */
  value: string;
  confidence: number;
  action: 'fill' | 'skip';
  /** Where the value came from. */
  source: 'profile' | 'llm' | 'none';
  /** True when confidence is below the review threshold; the overlay highlights these. */
  needsReview: boolean;
  /** Human-readable reason for skips (shown in the overlay). */
  reason?: string;
}

/** Outcome of applying one FillInstruction in the page. */
export interface FillResult {
  instruction: FillInstruction;
  label: string;
  status: 'filled' | 'skipped' | 'failed';
  reason?: string;
}

/** The user profile stored in chrome.storage.local. */
export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  linkedin: string;
  resumeText: string;
}

export const EMPTY_PROFILE: Profile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  linkedin: '',
  resumeText: '',
};

// ---------------------------------------------------------------------------
// Messaging (content ↔ background)
// ---------------------------------------------------------------------------

/** Background → content: user clicked the toolbar icon, start autofill. */
export interface StartAutofillMessage {
  type: 'START_AUTOFILL';
}

/** Content → background: classify these fields and return fill instructions. */
export interface ClassifyAndPlanMessage {
  type: 'CLASSIFY_AND_PLAN';
  fields: FieldCandidate[];
  pageUrl: string;
}

export type ExtensionMessage = StartAutofillMessage | ClassifyAndPlanMessage;

export type ClassifyAndPlanResponse =
  | { ok: true; instructions: FillInstruction[] }
  | { ok: false; error: string };
