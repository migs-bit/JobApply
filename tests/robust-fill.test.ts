import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeStep, plausibleKey, runSequence, SELECT_SEQUENCE, TEXT_SEQUENCE,
} from '../src/content/filler/event-sequence';
import { REVERTED, verifyResults } from '../src/content/filler/verify';
import type { FillResult } from '../src/shared/types';

// Node has Event and EventTarget but not the DOM's event subclasses: minimal stand-ins, enough to record what's dispatched.
const g = globalThis as Record<string, unknown>;
class StubEvent extends Event {
  key: string | undefined;
  data: string | null | undefined;
  constructor(type: string, init: EventInit & { key?: string; data?: string | null } = {}) {
    super(type, init);
    this.key = init.key;
    this.data = init.data;
  }
}
for (const name of ['FocusEvent', 'KeyboardEvent', 'MouseEvent', 'InputEvent']) g[name] ??= class extends StubEvent {};
g.HTMLSelectElement ??= class {};

/** A fake element that records method calls and events, in order. */
class FakeElement extends EventTarget {
  log: string[] = [];
  constructor(log?: string[]) {
    super();
    if (log) this.log = log;
  }
  focus() {
    this.log.push('focus()');
  }
  blur() {
    this.log.push('blur()');
  }
  override dispatchEvent(e: Event): boolean {
    const key = (e as StubEvent).key;
    this.log.push(`${e.type}${e.bubbles ? '↑' : ''}${key ? `[${key}]` : ''}`);
    return super.dispatchEvent(e);
  }
}

describe('fill event sequence: text inputs and textareas', () => {
  it('matches the spec: focus(), set, focus, keydown, input, keyup, change, blur(), blur (+ focusin/focusout for React)', () => {
    assert.deepEqual(TEXT_SEQUENCE.map(describeStep), ['focus()', 'set value', 'focus', 'focusin', 'keydown', 'input', 'keyup', 'change', 'blur()', 'blur', 'focusout']);
  });
  it('dispatches in that order; input and change bubble; keys are plausible', () => {
    const el = new FakeElement();
    const done = runSequence(el as unknown as HTMLElement, TEXT_SEQUENCE, { set: () => el.log.push('SET'), key: plausibleKey('Ada'), data: 'Ada' });
    assert.deepEqual(el.log, ['focus()', 'SET', 'focus', 'focusin↑', 'keydown↑[a]', 'input↑', 'keyup↑[a]', 'change↑', 'blur()', 'blur', 'focusout↑']);
    assert.deepEqual(done, TEXT_SEQUENCE.map(describeStep));
  });
  it('the value is set before any event fires', () => {
    const el = new FakeElement();
    runSequence(el as unknown as HTMLElement, TEXT_SEQUENCE, { set: () => el.log.push('SET') });
    assert.ok(el.log.indexOf('SET') < el.log.indexOf('focus'));
  });
});

describe('fill event sequence: native selects', () => {
  it('matches the spec: focus(), set, focus, mousedown, mouseup, click on option, click, input, change, blur(), blur (+ focusin/focusout)', () => {
    assert.deepEqual(SELECT_SEQUENCE.map(describeStep), [
      'focus()', 'set value', 'focus', 'focusin', 'mousedown', 'mouseup', 'click (option)', 'click', 'input', 'change', 'blur()', 'blur', 'focusout',
    ]);
  });
  it('the option click goes to the option; everything else to the select', () => {
    const log: string[] = [];
    const select = new FakeElement(log);
    const option = new FakeElement([]);
    option.log = log;
    const tag = (who: string) => (e: Event) => log.push(`  on ${who}: ${e.type}`);
    option.addEventListener('click', tag('option'));
    select.addEventListener('click', tag('select'));
    runSequence(select as unknown as HTMLElement, SELECT_SEQUENCE, { set: () => log.push('SET'), option: option as unknown as HTMLOptionElement });
    assert.deepEqual(log, [
      'focus()', 'SET', 'focus', 'focusin↑', 'mousedown↑', 'mouseup↑', 'click↑', '  on option: click', 'click↑', '  on select: click', 'input↑', 'change↑', 'blur()', 'blur', 'focusout↑',
    ]);
  });
});

describe('plausible keys', () => {
  it('the last character typed; Backspace when clearing; never a blank', () => {
    assert.equal(plausibleKey('ada@example.com'), 'm');
    assert.equal(plausibleKey('Toronto '), 'Unidentified');
    assert.equal(plausibleKey(''), 'Backspace');
    assert.equal(plausibleKey('Zoë'), 'ë');
  });
});

describe('post-fill verification pass', () => {
  const result = (fieldId: string, status: FillResult['status'], extra: Partial<FillResult> = {}): FillResult => ({
    fieldId, key: 'firstName', selector: `#${fieldId}`, status, confidence: 0.9, source: 'dictionary', requiresReview: false, previousValue: '', ...extra,
  });

  it('detects reverted values: filled → failed, "page reverted"', () => {
    const out = verifyResults([result('a', 'filled'), result('b', 'filled', { key: 'resume', attached: 'cv.pdf' })], () => false);
    assert.deepEqual(out.map((r) => [r.status, r.reason]), [['failed', REVERTED], ['failed', REVERTED]]);
    assert.equal(out[1]?.attached, undefined, 'a reverted file is no longer reported as attached');
  });
  it('does not flag fields that stuck', () => {
    const input = [result('a', 'filled'), result('b', 'filled')];
    const out = verifyResults(input, () => true);
    assert.deepEqual(out, input);
  });
  it('only re-checks filled fields; flags only the ones that changed', () => {
    const checked: string[] = [];
    const out = verifyResults(
      [result('a', 'filled'), result('b', 'skipped', { reason: 'not visible' }), result('c', 'failed', { reason: 'page did not keep the value' }), result('d', 'filled')],
      (r) => {
        checked.push(r.fieldId);
        return r.fieldId === 'a';
      },
    );
    assert.deepEqual(checked, ['a', 'd']);
    assert.deepEqual(out.map((r) => `${r.fieldId}:${r.status}:${r.reason ?? ''}`), ['a:filled:', 'b:skipped:not visible', 'c:failed:page did not keep the value', `d:failed:${REVERTED}`]);
  });
});
