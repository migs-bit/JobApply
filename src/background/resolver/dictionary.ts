import type { ResolvableKey } from '../../shared/types';

/**
 * Tier 1 and Tier 2 lookup tables.
 *
 * Patterns run against *normalized* text (see normalizeForMatching): lower
 * case, camelCase split, and `_ - . [ ] ( ) : * ✱` turned into single spaces.
 * So "first_name", "firstName", and "First Name ✱" all become "first name",
 * and every pattern can rely on \b word boundaries. That's why they differ
 * from the brief's sketch: e.g. its /cell/ would match "ex*cell*ent".
 *
 * ORDER MATTERS: keys are tried top to bottom and the first match wins, so
 * more specific keys come first (firstName before fullName, linkedin and
 * github before the generic website/url).
 */
export const FIELD_PATTERNS: ReadonlyArray<readonly [ResolvableKey, readonly RegExp[]]> = [
  ['firstName', [/\bfirst name\b/, /\bgiven name\b/, /\bfname\b/, /\bforename\b/]],
  ['lastName', [/\blast name\b/, /\bfamily name\b/, /\bsurname\b/, /\blname\b/]],
  ['fullName', [/\bfull name\b/, /\blegal name\b/, /^(your )?name$/]],
  ['email', [/\be ?mail\b/]],
  ['phone', [/\b(phone|mobile|cell|telephone|tel)\b/]],
  // Question keys come before the address keys: their questions contain
  // address words ("authorized to work in the country…", "relocate to another city?").
  ['workAuthorization', [/\b(authori[sz]ed|eligible|permitted) to work\b/, /\bwork authori[sz]ation\b/, /\bright to work\b/, /\bwork (permit|eligibility)\b/]],
  ['requiresSponsorship', [/\bsponsor(ship|ed)?\b/]],
  ['willingToRelocate', [/\brelocat(e|ion|ing)\b/]],
  ['desiredSalary', [
    /\b(desired|expected|target|requested) (salary|compensation|pay)\b/,
    /\b(salary|compensation|pay) (expectation|requirement|range)s?\b/,
    /^salary$/,
  ]],
  ['noticePeriod', [/\bnotice period\b/, /\b(weeks?|days?|months?) (of )?notice\b/, /\bhow much notice\b/]],
  ['gender', [/\bgender\b/, /\bsex\b/]],
  ['race', [/\brace\b/, /\bethnicity\b/, /\bracial\b/, /\bethnic (background|origin|group)\b/]],
  ['veteranStatus', [/\bveteran\b/, /\bmilitary (service|status)\b/]],
  ['disabilityStatus', [/\bdisabilit(y|ies)\b/, /\bdisabled\b/]],
  ['addressLine1', [/\baddress line 1\b/, /\baddress 1\b/, /^(street )?address$/, /^street\b/]],
  // "unit"/"suite" only at the start or as "<word> number": "Business unit" isn't an address.
  ['addressLine2', [/\baddress line 2\b/, /\baddress 2\b/, /^(apt|apartment|suite|unit)\b/, /\b(apt|apartment|suite|unit) (number|no)\b/]],
  ['city', [/\bcity\b/, /\btown\b/]],
  ['state', [/\bstate\b/, /\bprovince\b/, /\bregion\b/]],
  ['postalCode', [/\bzip( code)?\b/, /\bpostal( code)?\b/, /\bpostcode\b/]],
  ['country', [/\bcountry\b/]],
  ['linkedin', [/\blinked ?in\b/]],
  ['github', [/\bgit ?hub\b/]],
  // No bare /url/: "Project URL", "Twitter URL", "Replit Profile URL" are
  // links, but not the applicant's personal site. "url" only counts when
  // paired with personal/site wording.
  ['website', [/\bweb ?site\b/, /\bportfolio\b/, /\bpersonal (site|page|url|link)\b/, /\bsite url\b/]],
  // File inputs only (field-rules.ts). Covers "attach/upload resume", "upload CV", "Resume/CV", "Résumé"
  // (a lookahead, not \b, ends the first pattern: \b doesn't see a boundary after a trailing "é").
  ['resume', [/\br[eé]sum[eé]s?(?![a-z])/, /\bcvs?\b/, /\bcurriculum vitae\b/]],
];

/**
 * Text that means "this is about someone/something else", so a match would
 * be wrong: "Referrer email", "Emergency contact phone", "Company website",
 * "School city". Checked per source text; a hit disqualifies that text only.
 */
export const NEGATIVE_CONTEXT =
  /\b(referr?(al|er|ed)|reference|emergency|manager|supervisor|recruiter|company|employer|school|university|college)\b/;

/**
 * Per-key exceptions: text where a key's word is used in another sense.
 * "Please state your salary expectations" uses "state" as a verb. Checked by
 * Tiers 2 and 3 before accepting that key.
 */
export const KEY_EXCLUSIONS: Partial<Readonly<Record<ResolvableKey, RegExp>>> = {
  state: /\b(please|briefly|clearly|kindly) state\b|\bstate (your|why|how|what|whether|any|the reason)\b/,
  // Polarity guard: "authorized to work" wants Yes, "require sponsorship" wants
  // No. A question mixing both ("authorized to work… without sponsorship?") is
  // ambiguous, so it resolves to neither.
  workAuthorization: /\bsponsor/,
  requiresSponsorship: /\b(authori[sz]ed|eligible|permitted) to work\b|\bwithout (the )?(need (for|of) )?(visa )?sponsor/,
  // "Do you need relocation assistance?" is a different question from "willing to relocate?".
  willingToRelocate: /\brelocation (assistance|package|support|benefits?|stipend|bonus|expenses?)\b|\b(assist|help|pay)\w* (with )?relocat/,
  // Current pay is not desired pay (and some jurisdictions bar asking for it).
  desiredSalary: /\b(current|previous|prior|last|present) (base )?(salary|compensation|pay)\b/,
  // An interview-accommodation request isn't the self-identification question.
  disabilityStatus: /\baccommodat/,
  // Citizenship/nationality isn't the country you live in.
  country: /\bcitizen|\bnationality\b|\bpassport\b/,
  // Other documents: a file field that mentions any of these never gets the resume,
  // even "Resume and cover letter" (attaching only the resume there would be wrong).
  resume: /\bcover letters?\b|\bportfolios?\b|\bwriting samples?\b|\btranscripts?\b/,
};

/**
 * Keys whose patterns are specific enough to trust inside question prose
 * ("Do you require sponsorship, or will you…"). Lever puts card questions in
 * the field's surrounding text, not its label, so without this they'd never
 * match. Other keys (and all EEO keys) only match short, label-like text.
 */
export const PROSE_KEYS: ReadonlySet<ResolvableKey> = new Set([
  'workAuthorization',
  'requiresSponsorship',
  'willingToRelocate',
  'desiredSalary',
  'noticePeriod',
  // Only file inputs can take it, and "Please attach your most recent resume (PDF)" is prose.
  'resume',
]);

/**
 * Browser-standard autocomplete field tokens → keys (Tier 1).
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
 */
export const AUTOCOMPLETE_MAP: Readonly<Record<string, ResolvableKey>> = {
  name: 'fullName',
  'given-name': 'firstName',
  'family-name': 'lastName',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'address-line1': 'addressLine1',
  'address-line2': 'addressLine2',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'postalCode',
  country: 'country',
  'country-name': 'country',
  url: 'website',
  sex: 'gender',
};

/**
 * Tier 4 synonym phrases, compared by token-set similarity (tier-fuzzy.ts).
 * They're for wordings the regexes above miss ("Best number to reach you",
 * "Electronic mail address"). Phrases are tokenized the same way as field
 * text: stopwords like "what/you/to/the" dropped, so "call you" is just {call}.
 *
 * Keep these specific. A bare "url" or "name" here would re-create the false
 * positives the dictionary was tightened against.
 */
export const FUZZY_SYNONYMS: ReadonlyArray<readonly [ResolvableKey, readonly string[]]> = [
  ['firstName', ['first name', 'given name', 'preferred name', 'call you', 'forename']],
  ['lastName', ['last name', 'family name', 'surname']],
  ['fullName', ['full name', 'legal name', 'full legal name', 'complete name', 'applicant name', 'candidate name']],
  ['email', ['email address', 'electronic mail', 'electronic mail address', 'contact email']],
  ['phone', ['phone number', 'telephone number', 'mobile number', 'cell number', 'contact number', 'number to reach you']],
  ['addressLine1', ['street address', 'home address', 'mailing address', 'residential address', 'address line one']],
  ['addressLine2', ['address line two', 'apartment number', 'suite number', 'unit number']],
  ['city', ['city', 'town', 'city of residence', 'municipality', 'locality']],
  ['state', ['state', 'province', 'state or province', 'region']],
  ['postalCode', ['zip', 'zip code', 'zipcode', 'postal code', 'post code', 'postcode']],
  ['country', ['country', 'country of residence', 'nation']],
  // Both spellings: the camelCase split turns "LinkedIn" into "linked in", a lowercase attribute stays "linkedin".
  ['linkedin', ['linkedin', 'LinkedIn', 'linkedin profile', 'LinkedIn profile']],
  ['github', ['github', 'GitHub', 'github profile', 'GitHub profile']],
  ['website', ['personal website', 'portfolio', 'homepage', 'home page', 'personal site']],
  ['workAuthorization', ['work authorization', 'authorized to work', 'eligible to work', 'right to work']],
  ['requiresSponsorship', ['visa sponsorship', 'require sponsorship', 'sponsorship']],
  ['willingToRelocate', ['willing to relocate', 'open to relocation', 'relocate']],
  ['desiredSalary', ['desired salary', 'salary expectation', 'expected salary', 'desired compensation', 'compensation expectation']],
  ['noticePeriod', ['notice period', 'notice required']],
  ['gender', ['gender', 'gender identity', 'sex']],
  ['race', ['race', 'ethnicity', 'race ethnicity', 'ethnic background']],
  ['veteranStatus', ['veteran status', 'protected veteran', 'military status']],
  ['disabilityStatus', ['disability status', 'disability']],
];
