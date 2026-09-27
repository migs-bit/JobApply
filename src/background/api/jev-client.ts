import {
  CANONICAL_KEYS,
  type CanonicalKey,
  type FieldCandidate,
  type JevClassification,
} from '../../shared/types';

/**
 * Jev client — sends field metadata + candidate categories to the Jev decision
 * model and gets back { fieldId, key, confidence } for each field.
 *
 * TODO: replace the endpoint and key with real values (ideally the key should
 * live behind your own backend, not in the extension bundle).
 */
const JEV_ENDPOINT = 'https://jev.example.invalid/v1/classify';
const JEV_API_KEY = 'YOUR_JEV_API_KEY';

/**
 * While the real endpoint isn't wired up, fall back to a local keyword
 * heuristic so the rest of the pipeline can be exercised end to end.
 * Set to false once Jev is live.
 */
const USE_LOCAL_FALLBACK = true;

interface JevRequestBody {
  categories: readonly CanonicalKey[];
  items: Array<{ id: string; features: Omit<FieldCandidate, 'fieldId'> }>;
}

export async function classifyFields(fields: FieldCandidate[]): Promise<JevClassification[]> {
  const body: JevRequestBody = {
    categories: CANONICAL_KEYS,
    items: fields.map(({ fieldId, ...features }) => ({ id: fieldId, features })),
  };

  try {
    const res = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${JEV_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Jev responded ${res.status} ${res.statusText}`);

    const data: unknown = await res.json();
    console.log('[Jev] response', data);
    return parseJevResponse(data, fields);
  } catch (err) {
    console.warn('[Jev] request failed:', err);
    if (!USE_LOCAL_FALLBACK) throw err;
    const fallback = localFallbackClassify(fields);
    console.log('[Jev] using local fallback classification', fallback);
    return fallback;
  }
}

/** Validates the (assumed) response shape: JevClassification[]. */
function parseJevResponse(data: unknown, fields: FieldCandidate[]): JevClassification[] {
  if (!Array.isArray(data)) throw new Error('Unexpected Jev response shape (expected an array)');
  const known = new Set(fields.map((f) => f.fieldId));

  return data
    .filter(
      (item): item is JevClassification =>
        typeof item?.fieldId === 'string' &&
        known.has(item.fieldId) &&
        typeof item?.confidence === 'number',
    )
    .map((item) => ({
      fieldId: item.fieldId,
      key: (CANONICAL_KEYS as readonly string[]).includes(item.key) ? item.key : 'unknown',
      confidence: Math.max(0, Math.min(1, item.confidence)),
    }));
}

// ---------------------------------------------------------------------------
// Local fallback (dev only) — crude keyword rules, NOT a replacement for Jev.
// ---------------------------------------------------------------------------

const RULES: Array<{ key: CanonicalKey; pattern: RegExp }> = [
  { key: 'firstName', pattern: /\b(first|given)[\s_-]?name\b|\bfname\b/ },
  { key: 'lastName', pattern: /\b(last|family|sur)[\s_-]?name\b|\blname\b|\bsurname\b/ },
  { key: 'fullName', pattern: /\bfull[\s_-]?name\b|^name$|\byour name\b/ },
  { key: 'email', pattern: /e-?mail/ },
  { key: 'phone', pattern: /phone|mobile|\btel\b|cell/ },
  { key: 'linkedin', pattern: /linked\s?in/ },
  { key: 'resume', pattern: /resume|résumé|\bcv\b/ },
  { key: 'custom_question', pattern: /\bwhy\b|describe|tell us|\?$/ },
];

const AUTOCOMPLETE_MAP: Record<string, CanonicalKey> = {
  'given-name': 'firstName',
  'family-name': 'lastName',
  name: 'fullName',
  email: 'email',
  tel: 'phone',
};

function localFallbackClassify(fields: FieldCandidate[]): JevClassification[] {
  return fields.map((f) => {
    const ac = AUTOCOMPLETE_MAP[f.autocomplete.toLowerCase()];
    if (ac) return { fieldId: f.fieldId, key: ac, confidence: 0.95 };
    if (f.inputType === 'email') return { fieldId: f.fieldId, key: 'email', confidence: 0.9 };
    if (f.inputType === 'tel') return { fieldId: f.fieldId, key: 'phone', confidence: 0.9 };

    // Strong signals: label / aria-label / name / id.
    const strong = [f.label, f.ariaLabel, f.name, f.id].join(' ').toLowerCase().replace(/[_-]/g, ' ');
    // Weak signals: placeholder / nearby text.
    const weak = [f.placeholder, f.nearbyText].join(' ').toLowerCase();

    for (const { key, pattern } of RULES) {
      if (pattern.test(strong.trim())) return { fieldId: f.fieldId, key, confidence: 0.85 };
    }
    for (const { key, pattern } of RULES) {
      if (pattern.test(weak.trim())) return { fieldId: f.fieldId, key, confidence: 0.6 };
    }
    if (f.tagName === 'textarea') return { fieldId: f.fieldId, key: 'custom_question', confidence: 0.5 };
    return { fieldId: f.fieldId, key: 'unknown', confidence: 0.3 };
  });
}
