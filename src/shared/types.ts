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

/**
 * Keys computed from stored fields rather than stored themselves. Lever's
 * `name` and Ashby's "Name" are single full-name fields, which no stored key
 * covers. The filler builds the value from firstName + lastName.
 */
export type DerivedKey = 'fullName';

/** Everything the resolver can map a field to. */
export type ResolvableKey = ProfileKey | DerivedKey;

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
  key: ResolvableKey | 'unknown';
  /** 0..1 */
  confidence: number;
  source: ResolverSource;
  /**
   * Why this mapping was chosen (or why nothing was), e.g.
   * `label "First name" matched /\bfirst name\b/`. Makes every fill explainable.
   */
  evidence: string;
}

export interface FillInstruction {
  /** Ties the instruction back to its FieldCandidate/ResolvedField (logging, overlay). */
  fieldId: string;
  key: ResolvableKey;
  selector: string;
  value: string;
  confidence: number;
  source: ResolverSource;
  /** True when confidence is below REVIEW_THRESHOLD. */
  requiresReview: boolean;
}

/**
 * The service worker's answer to RESOLVE_FIELDS. Resolutions cover every
 * field and never carry values; instructions exist only for fields that
 * resolved *and* have a non-empty profile value. That's the only way profile
 * data reaches a content script.
 */
export interface FillPlan {
  resolutions: ResolvedField[];
  instructions: FillInstruction[];
}

/** Outcome of applying one FillInstruction in the page. Never includes the filled value. */
export interface FillResult {
  fieldId: string;
  key: ResolvableKey;
  selector: string;
  status: 'filled' | 'skipped' | 'failed';
  /** Why a field was skipped or failed. */
  reason?: string;
  confidence: number;
  source: ResolverSource;
  requiresReview: boolean;
  /** What the field held before filling, so the overlay's Undo (step 9) can restore it. */
  previousValue: string;
}

/** What the content script reports back to the popup: counts only, never values. */
export interface FillSummary {
  /** Fields the scanner found. */
  fields: number;
  /** Fields the resolver matched to a profile key. */
  matched: number;
  /** Fields with a saved profile value that the filler tried. */
  attempted: number;
  filled: number;
  /** Filled fields below REVIEW_THRESHOLD. */
  needsReview: number;
  failed: number;
}

/** Popup → content script (chrome.tabs.sendMessage). */
export type ContentMsg = { type: 'FILL_PAGE' };

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
