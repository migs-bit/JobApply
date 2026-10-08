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
  // Job preferences (free text).
  desiredSalary: string;
  noticePeriod: string;
  // Multiple-choice answers, stored as a choice code from shared/choices.ts
  // ('' = not set). Work eligibility codes are 'Yes' / 'No'.
  workAuthorization: string;
  requiresSponsorship: string;
  willingToRelocate: string;
  // Voluntary self-identification (EEO): optional, always flagged for review.
  gender: string;
  race: string;
  veteranStatus: string;
  disabilityStatus: string;
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

/**
 * Keys filled with a stored file instead of text. Only `<input type="file">`
 * fields can resolve to them (see field-rules.ts).
 */
export type FileKey = 'resume';

/** Everything the resolver can map a field to. */
export type ResolvableKey = ProfileKey | DerivedKey | FileKey;

/**
 * One fillable field, as extracted by the DOM scanner. A radio group (several
 * `<input type="radio">` sharing a name) is ONE field: `type` is "radio",
 * `selector` points at its first radio, `label`/`nearbyText` hold the
 * question, and `options` holds the radios' own labels ("Yes", "No").
 */
export interface FieldCandidate {
  /** Stable id, e.g. a hash of the selector. */
  id: string;
  /** CSS selector used to re-find the element (for a radio group, its first radio). */
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
  /** Radio groups only: each radio's label, in page order. Never used for matching, only diagnostics. */
  options?: string[];
}

/** Which resolver tier produced a match; recorded so every fill is explainable. */
export type ResolverSource = 'autocomplete' | 'dictionary' | 'learned' | 'fuzzy' | 'ai' | 'none';

/**
 * What a field resolves to: a profile key, 'learned' (an answer the user
 * taught for this exact question, see learned-store.ts), or 'unknown'.
 */
export type FillKey = ResolvableKey | 'learned';

export interface ResolvedField {
  fieldId: string;
  key: FillKey | 'unknown';
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
  key: FillKey;
  selector: string;
  value: string;
  /**
   * Dropdowns only: option texts that mean this answer, in priority order (see
   * shared/choices.ts). Absent means "match `value` itself".
   */
  optionCandidates?: readonly string[];
  /**
   * Dropdowns and radio groups only: option texts the user taught as meaning
   * this answer (learned option wordings). Tried only after optionCandidates
   * find nothing.
   */
  learnedOptions?: readonly string[];
  confidence: number;
  source: ResolverSource;
  /** True when confidence is below REVIEW_THRESHOLD (or the key is always reviewed). */
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
  /**
   * The stored resume's bytes, present only when a field resolved to `resume`
   * and a resume is uploaded. Sent once per plan, however many resume fields
   * the page has. Never logged.
   */
  resume?: ResumeFile;
}

/** The part of the stored resume a content script needs to attach it. */
export interface ResumeFile {
  filename: string;
  mimeType: string;
  base64: string;
  uploadedAt: number;
}

/** What the options page shows about the stored resume: never the bytes or the text itself. */
export interface ResumeSummary {
  filename: string;
  mimeType: string;
  /** Bytes. */
  size: number;
  uploadedAt: number;
  /** Words in the extracted text; 0 when extraction failed or found no text. */
  wordCount: number;
}

/** Outcome of applying one FillInstruction in the page. Never includes a filled text value. */
export interface FillResult {
  fieldId: string;
  key: FillKey;
  selector: string;
  status: 'filled' | 'skipped' | 'failed';
  /** Why a field was skipped or failed. */
  reason?: string;
  confidence: number;
  source: ResolverSource;
  requiresReview: boolean;
  /** What the field held before filling, so the overlay's Undo (step 9) can restore it. */
  previousValue: string;
  /** Dropdowns and radio groups, for diagnostics: the chosen option's text (null if none) and the options on offer. */
  choice?: { matched: string | null; options: string[]; viaLearned?: boolean };
  /** File inputs: the name of the file attached (a filename only, never a path). */
  attached?: string;
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
  /** Fields the overlay offers to "Teach this". */
  teachable: number;
  /** True when the confirmation overlay is on screen; the popup then closes so it doesn't cover it. */
  overlayShown: boolean;
  /** A resume was attached to at least one field. */
  resumeAttached: boolean;
  /** The page has a resume field, but no resume is uploaded. */
  resumeMissing: boolean;
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
  | { type: 'RESOLVE_FIELDS'; fields: FieldCandidate[] }
  // "Teach this" (content script, on a real click). Case 1: an unknown field's
  // question → the answer the user gave on the page.
  | { type: 'LEARN_ANSWER'; question: string; answer: string; kind: LearnedKind }
  // Case 2: a known choice key whose options didn't match → this option text
  // means the user's saved answer for that key.
  | { type: 'LEARN_OPTION'; key: ProfileKey; optionText: string }
  // Options page: view, edit, delete.
  | { type: 'GET_LEARNED' }
  | { type: 'UPDATE_LEARNED'; op: LearnedUpdate }
  // Options page: the resume. Text is extracted on the options page at upload
  // (it can run the PDF worker; the service worker can't) and sent along.
  | { type: 'SET_RESUME'; filename: string; base64: string; extractedText: string }
  | { type: 'GET_RESUME' }
  | { type: 'DELETE_RESUME' };

/** How a learned answer was given: typed text, or a chosen option. */
export type LearnedKind = 'text' | 'choice';

export type LearnedUpdate =
  | { action: 'editAnswer'; question: string; answer: string }
  | { action: 'deleteAnswer'; question: string }
  | { action: 'deleteOption'; key: ProfileKey; optionText: string }
  | { action: 'clearAll' };

export type MsgType = Msg['type'];

/** Every response has this envelope, so callers can't mistake an error for data. */
export type MsgResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: ProfileErrors };

/** Per-field validation messages, keyed by profile key. */
export type ProfileErrors = Partial<Record<ProfileKey, string>>;
