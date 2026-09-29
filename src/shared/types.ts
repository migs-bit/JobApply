/**
 * Types shared by the service worker, content script, and extension pages.
 */

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
  website: string;
  // Extendable: add the key here and to PROFILE_KEYS in constants.ts.
  // The resolver treats missing/empty keys as "no match".
}

export type ProfileKey = keyof Profile;

/** One fillable element, as extracted by the DOM scanner. */
export interface FieldCandidate {
  /** Stable id, e.g. a hash of the selector. */
  id: string;
  /** CSS selector used to re-find the element when filling. */
  selector: string;
  tag: 'input' | 'textarea' | 'select';
  /** The input `type` attribute (empty for textarea/select). */
  type: string;
  name: string;
  autocomplete: string;
  /** <label> text, if one was found. */
  label: string;
  placeholder: string;
  ariaLabel: string;
  /** Text from the field's surrounding container. */
  nearbyText: string;
}

/** Which resolver tier produced a match; recorded so every fill is explainable. */
export type ResolverSource = 'autocomplete' | 'dictionary' | 'fuzzy' | 'ai' | 'none';

export interface ResolvedField {
  fieldId: string;
  key: ProfileKey | 'unknown';
  /** 0..1 */
  confidence: number;
  source: ResolverSource;
}

export interface FillInstruction {
  selector: string;
  value: string;
  confidence: number;
  source: ResolverSource;
  /** True when confidence is below REVIEW_THRESHOLD. */
  requiresReview: boolean;
}

// ---------------------------------------------------------------------------
// Messages handled by the service worker
// ---------------------------------------------------------------------------

export type Msg =
  | { type: 'GET_PROFILE' }
  | { type: 'SET_PROFILE'; profile: Profile }
  // The resolver runs in the background so that adding the AI tier later
  // (which needs network access) is a one-file change.
  | { type: 'RESOLVE_FIELDS'; fields: FieldCandidate[] };

export type MsgType = Msg['type'];

/** Every response has this envelope, so callers can't mistake an error for data. */
export type MsgResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: ProfileErrors };

/** Per-field validation messages, keyed by profile key. */
export type ProfileErrors = Partial<Record<ProfileKey, string>>;
