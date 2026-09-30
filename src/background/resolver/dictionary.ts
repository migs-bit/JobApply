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
  ['addressLine1', [/\baddress line 1\b/, /\baddress 1\b/, /^(street )?address$/, /^street\b/]],
  ['addressLine2', [/\baddress line 2\b/, /\baddress 2\b/, /\b(apt|apartment|suite|unit)\b/]],
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
];

/**
 * Text that means "this is about someone/something else", so a match would
 * be wrong: "Referrer email", "Emergency contact phone", "Company website",
 * "School city". Checked per source text; a hit disqualifies that text only.
 */
export const NEGATIVE_CONTEXT =
  /\b(referr?(al|er|ed)|reference|emergency|manager|supervisor|recruiter|company|employer|school|university|college)\b/;

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
};
