import { CONFIDENCE } from '../../shared/constants';
import type { FieldCandidate, Profile, ResolvedField } from '../../shared/types';
import { AUTOCOMPLETE_MAP } from './dictionary';
import { canResolve, isCompatible } from './field-rules';

/**
 * Tier 1: the `autocomplete` attribute. It's the site telling us what the
 * field is in a browser standard, so a hit gets full confidence.
 *
 * The attribute is a token list, e.g. "section-apply shipping given-name" or
 * "work email webauthn". The field name is the last token (ignoring the
 * trailing "webauthn" hint); "on"/"off" carry no meaning.
 */
export function tierAutocomplete(field: FieldCandidate, profile: Profile): ResolvedField | null {
  const tokens = field.autocomplete.toLowerCase().split(/\s+/).filter((t) => t && t !== 'webauthn');
  const token = tokens.at(-1);
  if (!token || token === 'on' || token === 'off') return null;

  const key = Object.hasOwn(AUTOCOMPLETE_MAP, token) ? AUTOCOMPLETE_MAP[token] : undefined;
  if (!key || !isCompatible(field, key) || !canResolve(profile, key)) return null;

  return {
    fieldId: field.id,
    key,
    confidence: CONFIDENCE.autocomplete,
    source: 'autocomplete',
    evidence: `autocomplete="${field.autocomplete}"`,
  };
}
