import { CHOICES, choiceFor, normalizeOptionText } from '../../shared/choices';
import { LIMITS, STORAGE_KEYS } from '../../shared/constants';
import { normalizeQuestion } from '../../shared/question';
import type { LearnedKind, ProfileKey } from '../../shared/types';

/**
 * Everything the user taught with "Teach this". Two separate maps, two
 * separate lookup paths:
 *
 *   answers         Case 1: a field the resolver couldn't place (a custom
 *                   question). normalized question text → the user's answer.
 *                   Looked up by resolver Tier 3 (tier-learned.ts).
 *
 *   optionSynonyms  Case 2: a known choice key (e.g. veteranStatus) whose
 *                   dropdown/radio options didn't match the built-in synonyms.
 *                   key → normalized option text → canonical choice code.
 *                   Looked up by the dropdown/radio fillers, after the
 *                   built-in synonyms fail (fill-plan.ts sends the texts).
 *
 * No site or URL is stored: an entry is tied to question/option text only.
 * Pure functions (no chrome.* at module load) so they're unit tested; only
 * getLearned / saveLearned touch storage.
 */

export interface LearnedAnswer {
  /** The question as the user saw it (for the options page). */
  question: string;
  answer: string;
  kind: LearnedKind;
  updatedAt: number;
}

export interface LearnedOption {
  /** The option text as the site wrote it (for the options page and for matching). */
  optionText: string;
  /** The canonical choice code it means, e.g. "not_veteran". */
  code: string;
  updatedAt: number;
}

export interface LearnedStore {
  answers: Record<string, LearnedAnswer>;
  optionSynonyms: Partial<Record<ProfileKey, Record<string, LearnedOption>>>;
}

export const EMPTY_LEARNED: LearnedStore = Object.freeze({ answers: {}, optionSynonyms: {} }) as LearnedStore;

export type LearnResult = { ok: true; store: LearnedStore; message: string } | { ok: false; error: string };

// Control and bidi-override characters out; newlines and tabs stay (paragraph answers).
const UNSAFE_ANSWER_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
const cleanAnswer = (s: string) => s.normalize('NFC').replace(UNSAFE_ANSWER_CHARS, '').trim().slice(0, LIMITS.learnedAnswerLength);
const cleanLine = (s: string) => s.normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, ' ').trim().slice(0, LIMITS.fieldTextLength);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Coerces stored data (possibly old or tampered with) into a well-formed store. Never throws. */
export function sanitizeLearned(raw: unknown): LearnedStore {
  const store: LearnedStore = { answers: {}, optionSynonyms: {} };
  if (!isRecord(raw)) return store;

  if (isRecord(raw.answers)) {
    for (const entry of Object.values(raw.answers).slice(0, LIMITS.learnedEntries)) {
      if (!isRecord(entry)) continue;
      const question = cleanLine(str(entry.question));
      const answer = cleanAnswer(str(entry.answer));
      const key = normalizeQuestion(question);
      if (!key || !answer) continue;
      store.answers[key] = { question, answer, kind: entry.kind === 'choice' ? 'choice' : 'text', updatedAt: Number(entry.updatedAt) || 0 };
    }
  }
  if (isRecord(raw.optionSynonyms)) {
    let count = 0;
    for (const [key, map] of Object.entries(raw.optionSynonyms)) {
      if (!Object.hasOwn(CHOICES, key) || !isRecord(map)) continue;
      for (const entry of Object.values(map)) {
        if (count >= LIMITS.learnedEntries || !isRecord(entry)) continue;
        const optionText = cleanLine(str(entry.optionText));
        const code = str(entry.code);
        const norm = normalizeOptionText(optionText);
        if (!norm || !choiceFor(key, code)) continue;
        (store.optionSynonyms[key as ProfileKey] ??= {})[norm] = { optionText, code, updatedAt: Number(entry.updatedAt) || 0 };
        count++;
      }
    }
  }
  return store;
}

/** Case 1: remember the answer to a question. Re-teaching the same question replaces its answer. */
export function learnAnswer(store: LearnedStore, question: string, answer: string, kind: LearnedKind, now = Date.now()): LearnResult {
  const shown = cleanLine(question);
  const key = normalizeQuestion(shown);
  const value = cleanAnswer(answer);
  if (!key) return { ok: false, error: 'This field has no question text to remember it by.' };
  if (!value) return { ok: false, error: 'Answer the field on the page first, then click Teach this.' };
  if (!Object.hasOwn(store.answers, key) && Object.keys(store.answers).length >= LIMITS.learnedEntries) {
    return { ok: false, error: 'Too many learned answers. Delete some in Options.' };
  }
  const answers = { ...store.answers, [key]: { question: shown, answer: value, kind, updatedAt: now } };
  return { ok: true, store: { ...store, answers }, message: 'Learned. This answer will be used next time.' };
}

/**
 * Case 2: remember that `optionText` means the user's saved answer `code` for
 * `key`. Refused if the built-in synonyms already give that text a different
 * meaning, so a slip can't make "I am a veteran" mean "not a veteran".
 */
export function learnOption(store: LearnedStore, key: ProfileKey, optionText: string, code: string, now = Date.now()): LearnResult {
  const choice = choiceFor(key, code);
  if (!choice) return { ok: false, error: 'Save an answer for this question in Options first.' };
  const shown = cleanLine(optionText);
  const norm = normalizeOptionText(shown);
  if (!norm) return { ok: false, error: 'Choose an option on the page first, then click Teach this.' };
  const builtIn = (CHOICES[key] ?? []).find((c) => c.synonyms.some((s) => normalizeOptionText(s) === norm));
  if (builtIn && builtIn.code !== code) {
    return { ok: false, error: `"${shown}" already means "${builtIn.label}", which isn't your saved answer.` };
  }
  const existing = store.optionSynonyms[key] ?? {};
  const total = Object.values(store.optionSynonyms).reduce((n, m) => n + Object.keys(m ?? {}).length, 0);
  if (!Object.hasOwn(existing, norm) && total >= LIMITS.learnedEntries) {
    return { ok: false, error: 'Too many learned option wordings. Delete some in Options.' };
  }
  const optionSynonyms = { ...store.optionSynonyms, [key]: { ...existing, [norm]: { optionText: shown, code, updatedAt: now } } };
  return { ok: true, store: { ...store, optionSynonyms }, message: `Learned: "${shown}" means "${choice.label}".` };
}

/** Option texts taught as meaning `code` for `key`: what a filler may try after the built-in synonyms. */
export function learnedOptionsFor(store: LearnedStore, key: ProfileKey, code: string): string[] {
  return Object.values(store.optionSynonyms[key] ?? {})
    .filter((o) => o.code === code)
    .map((o) => o.optionText);
}

export function editAnswer(store: LearnedStore, question: string, answer: string): LearnResult {
  const key = normalizeQuestion(question);
  const current = store.answers[key];
  if (!current) return { ok: false, error: 'That learned answer no longer exists.' };
  const value = cleanAnswer(answer);
  if (!value) return { ok: false, error: 'An answer can’t be empty. Delete it instead.' };
  return { ok: true, store: { ...store, answers: { ...store.answers, [key]: { ...current, answer: value, updatedAt: Date.now() } } }, message: 'Saved.' };
}

export function deleteAnswer(store: LearnedStore, question: string): LearnedStore {
  const { [normalizeQuestion(question)]: _removed, ...answers } = store.answers;
  return { ...store, answers };
}

export function deleteOption(store: LearnedStore, key: ProfileKey, optionText: string): LearnedStore {
  const { [normalizeOptionText(optionText)]: _removed, ...rest } = store.optionSynonyms[key] ?? {};
  return { ...store, optionSynonyms: { ...store.optionSynonyms, [key]: rest } };
}

// ---------------------------------------------------------------------------
// Storage (service worker only; storage is locked to extension contexts)
// ---------------------------------------------------------------------------

export async function getLearned(): Promise<LearnedStore> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.learned);
  return sanitizeLearned(stored[STORAGE_KEYS.learned]);
}

export async function saveLearned(store: LearnedStore): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.learned]: store });
}
