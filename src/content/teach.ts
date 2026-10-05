import { CHOICES } from '../shared/choices';
import { sendToBackground } from '../shared/messaging';
import { questionTextOf } from '../shared/question';
import type { FieldCandidate, FillPlan, FillResult, Msg, ProfileKey } from '../shared/types';
import { labelOf } from './diagnostics';
import { isTeachable, readAnswer } from './filler/read-answer';
import type { TeachOutcome, TeachRow } from './overlay/teach-section';

/**
 * "Teach this": which fields to offer, and what teaching sends. Two cases,
 * matching the two maps in learned-store.ts:
 *
 *   option    A known choice key (e.g. veteranStatus) whose dropdown/radio
 *             options didn't match. The user picks the right option on the
 *             page; we remember "this option text means my saved answer".
 *   question  A field nothing could place (a custom question). The user
 *             answers it on the page; we remember "question → answer".
 */

interface Teachable {
  row: TeachRow;
  field: FieldCandidate;
  kind: 'option' | 'question';
  key?: ProfileKey;
}

const OPTION_FAILURES = new Set(['no option matched', 'multiple matches']);

export function teachableFields(fields: FieldCandidate[], plan: FillPlan, results: FillResult[]): Teachable[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const out: Teachable[] = [];

  // Case 2 first: these are questions the user already answered in their profile.
  for (const r of results) {
    const field = byId.get(r.fieldId);
    if (!field || r.status !== 'skipped' || !OPTION_FAILURES.has(r.reason ?? '') || !Object.hasOwn(CHOICES, r.key)) continue;
    if (!isTeachable(field)) continue;
    out.push({
      field,
      kind: 'option',
      key: r.key as ProfileKey,
      row: { fieldId: field.id, label: labelOf(fields, field.id), hint: 'Pick the option that matches your saved answer, then teach it.' },
    });
  }
  // Case 1: fields nothing could place.
  for (const r of plan.resolutions) {
    const field = byId.get(r.fieldId);
    if (!field || r.key !== 'unknown' || !questionTextOf(field) || !isTeachable(field)) continue;
    out.push({
      field,
      kind: 'question',
      row: { fieldId: field.id, label: labelOf(fields, field.id), hint: 'Answer it on the page, then teach it.' },
    });
  }
  return out;
}

/** Reads the user's answer on the page and asks the service worker to remember it. */
export async function teach(item: Teachable): Promise<TeachOutcome> {
  const given = readAnswer(item.field);
  if (!given) {
    return { ok: false, message: item.kind === 'option' ? 'Pick an option on the page first, then click Teach this.' : 'Answer it on the page first, then click Teach this.' };
  }
  const msg: Msg =
    item.kind === 'option' && item.key
      ? { type: 'LEARN_OPTION', key: item.key, optionText: given.answer }
      : { type: 'LEARN_ANSWER', question: questionTextOf(item.field), answer: given.answer, kind: given.kind };
  const res = await sendToBackground<{ message: string }>(msg);
  return res.ok ? { ok: true, message: res.data.message } : { ok: false, message: res.error };
}
