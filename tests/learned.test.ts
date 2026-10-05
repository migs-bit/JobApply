import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFillPlan } from '../src/background/fill-plan';
import { resolveField } from '../src/background/resolver/field-resolver';
import {
  deleteAnswer, deleteOption, editAnswer, EMPTY_LEARNED, learnAnswer, learnedOptionsFor, learnOption, sanitizeLearned, type LearnedStore,
} from '../src/background/storage/learned-store';
import { matchChoice } from '../src/content/filler/option-match';
import { EMPTY_PROFILE, LIMITS } from '../src/shared/constants';
import { normalizeQuestion, questionTextOf } from '../src/shared/question';
import type { FieldCandidate } from '../src/shared/types';

function field(overrides: Partial<FieldCandidate>): FieldCandidate {
  return {
    id: 'f', selector: '#f', tag: 'input', type: 'text', name: '', autocomplete: '',
    label: '', placeholder: '', ariaLabel: '', nearbyText: '', ...overrides,
  };
}
const ok = <T extends { ok: boolean }>(r: T) => {
  assert.ok(r.ok, JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};
const store = (fn: (s: LearnedStore) => ReturnType<typeof learnAnswer>, from: LearnedStore = EMPTY_LEARNED) => ok(fn(from)).store;

describe('question text and normalization', () => {
  it('label, then aria-label, then nearby question text, then placeholder', () => {
    assert.equal(questionTextOf(field({ label: 'A', ariaLabel: 'B', nearbyText: 'C', placeholder: 'D' })), 'A');
    assert.equal(questionTextOf(field({ nearbyText: 'How did you hear about us? ✱', placeholder: 'Type your response' })), 'How did you hear about us? ✱');
  });
  it('case, punctuation, required markers and spacing don’t matter', () => {
    assert.equal(normalizeQuestion('  How did you HEAR about us? ✱ '), normalizeQuestion('how did you hear about us'));
  });
});

describe('learned store, case 1: question → answer', () => {
  it('learns, cleans, and re-teaching replaces', () => {
    let s = store((x) => learnAnswer(x, 'How did you hear about us? ✱', '  LinkedIn‮ ', 'text', 1));
    assert.deepEqual(s.answers[normalizeQuestion('how did you hear about us')], { question: 'How did you hear about us? ✱', answer: 'LinkedIn', kind: 'text', updatedAt: 1 });
    s = store((x) => learnAnswer(x, 'how did you hear about us', 'A friend', 'text', 2), s);
    assert.equal(Object.keys(s.answers).length, 1);
    assert.equal(Object.values(s.answers)[0]?.answer, 'A friend');
  });
  it('keeps line breaks in paragraph answers', () => {
    const s = store((x) => learnAnswer(x, 'Tell us about yourself', 'Line one\nLine two', 'text'));
    assert.equal(Object.values(s.answers)[0]?.answer, 'Line one\nLine two');
  });
  it('refuses an empty answer, a question-less field, and more than the cap', () => {
    assert.equal(learnAnswer(EMPTY_LEARNED, 'Q', '   ', 'text').ok, false);
    assert.equal(learnAnswer(EMPTY_LEARNED, ' ✱ ', 'x', 'text').ok, false);
    const full: LearnedStore = {
      ...EMPTY_LEARNED,
      answers: Object.fromEntries(Array.from({ length: LIMITS.learnedEntries }, (_, i) => [`q${i}`, { question: `q${i}`, answer: 'a', kind: 'text' as const, updatedAt: 0 }])),
    };
    assert.equal(learnAnswer(full, 'a brand new question', 'x', 'text').ok, false);
    assert.equal(learnAnswer(full, 'q1', 'replacing is fine', 'text').ok, true);
  });
  it('edit and delete', () => {
    let s = store((x) => learnAnswer(x, 'Preferred work arrangement', 'Remote', 'choice'));
    s = ok(editAnswer(s, 'preferred work arrangement', 'Hybrid')).store;
    assert.equal(Object.values(s.answers)[0]?.answer, 'Hybrid');
    assert.equal(editAnswer(s, 'preferred work arrangement', '  ').ok, false);
    assert.deepEqual(deleteAnswer(s, 'Preferred work arrangement').answers, {});
  });
});

describe('learned store, case 2: option text → canonical code', () => {
  it('learns an option wording for the saved answer', () => {
    const r = ok(learnOption(EMPTY_LEARNED, 'veteranStatus', "No, I'm not a veteran", 'not_veteran', 1));
    assert.match(r.message, /"No, I'm not a veteran" means "I am not a protected veteran"/);
    assert.deepEqual(learnedOptionsFor(r.store, 'veteranStatus', 'not_veteran'), ["No, I'm not a veteran"]);
    assert.deepEqual(learnedOptionsFor(r.store, 'veteranStatus', 'protected_veteran'), []);
    assert.deepEqual(learnedOptionsFor(r.store, 'gender', 'not_veteran'), []);
  });
  it('refuses wording the built-in table gives a different meaning', () => {
    assert.equal(learnOption(EMPTY_LEARNED, 'veteranStatus', 'I am a veteran', 'not_veteran').ok, false);
  });
  it('refuses when no answer is saved for that question', () => {
    assert.equal(learnOption(EMPTY_LEARNED, 'veteranStatus', 'Nope', '').ok, false);
  });
  it('delete', () => {
    const s = ok(learnOption(EMPTY_LEARNED, 'gender', 'Woman (she/her)', 'female')).store;
    assert.deepEqual(learnedOptionsFor(deleteOption(s, 'gender', 'woman she her'), 'gender', 'female'), []);
  });
});

describe('sanitizing stored data', () => {
  it('drops junk, unknown keys, invalid codes, and any extra fields (no site/URL is ever kept)', () => {
    const s = sanitizeLearned({
      answers: { x: { question: 'Q?', answer: 'A', kind: 'text', url: 'https://example.com', site: 'example.com' }, y: 'junk', z: { question: '', answer: 'A' } },
      optionSynonyms: { veteranStatus: { a: { optionText: 'Nope', code: 'not_veteran' }, b: { optionText: 'Bad', code: 'nonsense' } }, email: { c: { optionText: 'x', code: 'y' } } },
      extra: true,
    });
    assert.deepEqual(Object.keys(s.answers), [normalizeQuestion('Q?')]);
    assert.deepEqual(Object.keys(s.answers[normalizeQuestion('Q?')] ?? {}).sort(), ['answer', 'kind', 'question', 'updatedAt']);
    assert.deepEqual(learnedOptionsFor(s, 'veteranStatus', 'not_veteran'), ['Nope']);
    assert.equal(Object.keys(s.optionSynonyms).join(), 'veteranStatus');
    assert.equal(JSON.stringify(s).includes('example.com'), false);
  });
});

describe('Tier 3 (learned) in the resolver: case 1 only', () => {
  const learned = store((x) => learnAnswer(x, 'How did you hear about us?', 'LinkedIn', 'text'));
  it('an unknown question with a taught answer resolves as learned, at 0.85', () => {
    const r = resolveField(field({ nearbyText: 'How did you hear about us? ✱' }), EMPTY_PROFILE, learned);
    assert.deepEqual([r.key, r.source, r.confidence], ['learned', 'learned', 0.85]);
    assert.ok(!r.evidence.includes('LinkedIn'), 'the answer never appears in evidence (dev logs)');
  });
  it('runs after the dictionary: a taught answer never overrides a profile match', () => {
    const l = store((x) => learnAnswer(x, 'Email', 'someone@else.com', 'text'));
    assert.equal(resolveField(field({ label: 'Email' }), EMPTY_PROFILE, l).key, 'email');
  });
  it('runs before fuzzy: a taught answer beats a guess', () => {
    const l = store((x) => learnAnswer(x, 'Best number to reach you', '555 0100', 'text'));
    assert.equal(resolveField(field({ label: 'Best number to reach you' }), EMPTY_PROFILE).source, 'fuzzy');
    assert.equal(resolveField(field({ label: 'Best number to reach you' }), EMPTY_PROFILE, l).source, 'learned');
  });
  it('never applies to fields that can’t be filled (password, checkbox, file)', () => {
    const l = store((x) => learnAnswer(x, 'Secret', 'x', 'text'));
    for (const type of ['password', 'checkbox', 'file']) assert.equal(resolveField(field({ type, label: 'Secret' }), EMPTY_PROFILE, l).key, 'unknown');
  });
});

describe('fill plan: two separate paths', () => {
  it('case 1: a learned answer becomes the value (and the option to pick); dropdown and radio answers aren’t flagged', () => {
    const one = store((x) => learnAnswer(x, 'Preferred work arrangement', 'Remote', 'choice'));
    const learned = store((x) => learnAnswer(x, 'Open to contract roles?', 'Yes', 'choice'), one);
    const plan = buildFillPlan(
      [field({ id: 's', tag: 'select', type: '', label: 'Preferred work arrangement' }), field({ id: 'r', type: 'radio', label: 'Open to contract roles?', options: ['Yes', 'No'] })],
      EMPTY_PROFILE,
      learned,
    );
    assert.deepEqual(plan.instructions.map((i) => [i.key, i.value, i.optionCandidates?.[0], i.requiresReview, i.confidence]), [
      ['learned', 'Remote', 'Remote', false, 0.85],
      ['learned', 'Yes', 'Yes', false, 0.85],
    ]);
  });
  it('case 1: a learned answer typed into a text field or textarea is always flagged for review', () => {
    const one = store((x) => learnAnswer(x, 'How did you hear about us?', 'LinkedIn', 'text'));
    const learned = store((x) => learnAnswer(x, 'Why do you want to work here?', 'Because…', 'text'), one);
    const plan = buildFillPlan(
      [field({ id: 't', label: 'How did you hear about us?' }), field({ id: 'a', tag: 'textarea', type: '', label: 'Why do you want to work here?' })],
      EMPTY_PROFILE,
      learned,
    );
    assert.deepEqual(plan.instructions.map((i) => [i.fieldId, i.requiresReview, i.confidence]), [['t', true, 0.85], ['a', true, 0.85]]);
  });
  it('even an answer first taught from a dropdown is flagged when it’s typed into a text field', () => {
    const learned = store((x) => learnAnswer(x, 'Preferred work arrangement', 'Remote', 'choice'));
    const plan = buildFillPlan([field({ label: 'Preferred work arrangement' })], EMPTY_PROFILE, learned);
    assert.equal(plan.instructions[0]?.requiresReview, true);
  });
  it('case 2: learned option wordings ride along for the saved code only, after the built-in synonyms', () => {
    const learned = ok(learnOption(EMPTY_LEARNED, 'veteranStatus', "No, I'm not a veteran", 'not_veteran')).store;
    const plan = buildFillPlan([field({ tag: 'select', type: '', name: 'eeo[veteran]', label: 'Veteran status' })], { ...EMPTY_PROFILE, veteranStatus: 'not_veteran' }, learned);
    const i = plan.instructions[0];
    assert.equal(i?.key, 'veteranStatus');
    assert.deepEqual(i?.learnedOptions, ["No, I'm not a veteran"]);
    assert.equal(i?.optionCandidates?.[0], 'I am not a protected veteran');
    assert.equal(i?.requiresReview, true, 'EEO stays always-review');
  });
  it('a learned answer whose question matches a dictionary key does not hijack that key', () => {
    const learned = store((x) => learnAnswer(x, 'Veteran status', 'Something else', 'choice'));
    const plan = buildFillPlan([field({ tag: 'select', type: '', label: 'Veteran status' })], { ...EMPTY_PROFILE, veteranStatus: 'decline' }, learned);
    assert.equal(plan.instructions[0]?.key, 'veteranStatus');
  });
});

describe('option matching with learned wordings', () => {
  const opts = (...t: string[]) => t.map((text) => ({ text, value: text }));
  it('built-in synonyms win when they match', () => {
    const m = matchChoice(opts('I am not a veteran', "No, I'm not a veteran"), ['I am not a veteran'], ["No, I'm not a veteran"]);
    assert.deepEqual(m, { index: 0, matched: 'I am not a veteran', viaLearned: false });
  });
  it('learned wordings are tried when the built-in ones find nothing', () => {
    const m = matchChoice(opts("No, I'm not a veteran", 'Yes, I served'), ['I am not a veteran'], ["No, I'm not a veteran"]);
    assert.deepEqual(m, { index: 0, matched: "No, I'm not a veteran", viaLearned: true });
  });
  it('still "no option matched" when neither matches', () => {
    assert.deepEqual(matchChoice(opts('Nope'), ['I am not a veteran'], ['Something else']), { reason: 'no option matched' });
  });
});
