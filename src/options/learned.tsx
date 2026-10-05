/**
 * Options page: view, edit and delete what "Teach this" remembered. Mirrors
 * the two maps in learned-store.ts: answers to questions (case 1) and option
 * wordings for known questions (case 2). Everything goes through the service
 * worker (GET_LEARNED / UPDATE_LEARNED). Page text is rendered by React, so
 * it's always escaped.
 */
import { useEffect, useState } from 'react';
import type { LearnedStore } from '../background/storage/learned-store';
import { choiceFor } from '../shared/choices';
import { sendToBackground } from '../shared/messaging';
import type { LearnedUpdate, ProfileKey } from '../shared/types';
import { SECTIONS } from './fields';

const KEY_LABELS = new Map<string, string>(SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f.label] as const)));

export function LearnedAnswers() {
  const [store, setStore] = useState<LearnedStore | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void sendToBackground<LearnedStore>({ type: 'GET_LEARNED' }).then((res) => setStore(res.ok ? res.data : null));
  }, []);

  const update = async (op: LearnedUpdate) => {
    const res = await sendToBackground<{ message: string; store: LearnedStore }>({ type: 'UPDATE_LEARNED', op });
    if (res.ok) setStore(res.data.store);
    setMessage(res.ok ? res.data.message : res.error);
  };

  const answers = Object.values(store?.answers ?? {}).sort((a, b) => a.question.localeCompare(b.question));
  const options = Object.entries(store?.optionSynonyms ?? {}).flatMap(([key, map]) =>
    Object.values(map ?? {}).map((o) => ({ key: key as ProfileKey, ...o })),
  );

  return (
    <section aria-labelledby="h-learned">
      <h2 id="h-learned">Learned answers</h2>
      <p className="hint section-note">
        What you taught with "Teach this" in the results panel. Stored only on this device, tied to the question text
        (no site or address is kept).
      </p>

      {answers.length === 0 && options.length === 0 && <p className="hint">Nothing learned yet.</p>}

      {answers.length > 0 && (
        <>
          <h3>Answers to questions</h3>
          <ul className="learned-list">
            {answers.map((a) => (
              <AnswerRow key={a.question} question={a.question} answer={a.answer} onUpdate={update} />
            ))}
          </ul>
        </>
      )}

      {options.length > 0 && (
        <>
          <h3>Option wordings</h3>
          <ul className="learned-list">
            {options.map((o) => (
              <li key={`${o.key}|${o.optionText}`} className="learned-item">
                <span>
                  <strong>{KEY_LABELS.get(o.key) ?? o.key}:</strong> "{o.optionText}" means "{choiceFor(o.key, o.code)?.label ?? o.code}"
                </span>
                <button type="button" className="secondary" onClick={() => void update({ action: 'deleteOption', key: o.key, optionText: o.optionText })}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {(answers.length > 0 || options.length > 0) && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            if (window.confirm('Delete all learned answers and option wordings?')) void update({ action: 'clearAll' });
          }}
        >
          Delete all learned answers
        </button>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function AnswerRow(props: { question: string; answer: string; onUpdate: (op: LearnedUpdate) => Promise<void> }) {
  const { question, answer, onUpdate } = props;
  const [draft, setDraft] = useState(answer);
  useEffect(() => setDraft(answer), [answer]);
  return (
    <li className="learned-item answer">
      <label>
        {question}
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(6, Math.max(1, draft.split('\n').length))} />
      </label>
      <span className="learned-actions">
        <button type="button" disabled={draft.trim() === answer} onClick={() => void onUpdate({ action: 'editAnswer', question, answer: draft })}>
          Save
        </button>
        <button type="button" className="secondary" onClick={() => void onUpdate({ action: 'deleteAnswer', question })}>
          Delete
        </button>
      </span>
    </li>
  );
}
