// Step 7: filling. test-page/filler-cases.html declares each field's expected
// outcome (data-expect-fill); plus React-controlled inputs, the Lever-style
// fixture, the filler's guards called directly, and no values in any log.
import { join } from 'node:path';
import {
  bundleIife, extensionWithHostAccess, launchChrome, leakedValues, ROOT, serveFixtures, sleep, Suite, tableAfter, TEST_PROFILE, uniqueUrl,
} from './lib/harness.mjs';

export async function run({ devDist }) {
  const suite = new Suite('fill');
  const reactApp = await bundleIife(join(ROOT, 'tests/e2e/fixtures/react-form.tsx'));
  const fillerBundle = await bundleIife(join(ROOT, 'tests/e2e/fixtures/filler-entry.ts'));
  const server = await serveFixtures({
    '/react.html': '<!doctype html><h1>React form</h1><div id="root"></div><script src="react-app.js"></script>',
    '/react-app.js': reactApp,
  });
  const browser = await launchChrome();
  const pages = [];
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist));
    suite.check('test profile saved', (await browser.saveProfile(ext, TEST_PROFILE))?.ok === true);

    // ---- filler-cases.html: every declared outcome ----
    const fx = await browser.open(uniqueUrl(`${server.origin}/filler-cases.html`));
    pages.push(fx);
    const reply = await browser.injectAndFill(ext, fx.url);
    const rows = tableAfter(fx, 'fill:');
    suite.check('fixture: scan → plan → fill ran', reply?.ok === true && rows.length > 0, JSON.stringify(reply?.data));
    const mismatches = await fx.evaluate(`((rows) => {
      const out = [];
      for (const el of document.querySelectorAll('[data-expect-fill]')) {
        const want = el.dataset.expectFill, label = el.labels?.[0]?.textContent.trim() || el.placeholder;
        const row = want === 'untouched' ? undefined : rows.find((r) => r.field === label);
        const got = row ? (row.status === 'filled' ? 'filled' : row.status + ': ' + row.reason) : 'untouched';
        if (got !== want) out.push(label + ': expected ' + want + ', got ' + got);
        if (want === 'filled' && !el.value) out.push(label + ': reported filled but empty');
        if (want !== 'filled' && el.id !== 'ln' && el.value) out.push(label + ': should be empty');
      }
      return out;
    })(${JSON.stringify(rows)})`);
    suite.check('fixture: every field has its expected outcome (incl. all hidden-field phishing variants)', Array.isArray(mismatches) && mismatches.length === 0, JSON.stringify(mismatches));
    const v = await fx.evaluate(`({ fn: fn.value, ln: ln.value, addr: addr.value, country: country.value, pw: pw.value })`);
    suite.check('fixture: right values; select matched by option text; prefilled kept; password untouched',
      v.fn === 'Ada' && v.ln === 'Existing' && v.addr === TEST_PROFILE.addressLine1 && v.country === 'CA' && v.pw === '', JSON.stringify(v));

    await fx.evaluate(`(() => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(fn, 'Changed by user'); fn.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.injectAndFill(ext, fx.url);
    suite.check('running again never overwrites what the user typed', (await fx.evaluate('fn.value')) === 'Changed by user');

    // ---- React ----
    const react = await browser.open(uniqueUrl(`${server.origin}/react.html`));
    pages.push(react);
    await browser.injectAndFill(ext, react.url);
    const state = await react.evaluate('window.__reactState');
    suite.check('React: component state updated by the fill, not just the DOM', state?.first === 'Ada' && state?.email === TEST_PROFILE.email && state?.country === 'CA');
    const locked = tableAfter(react, 'fill:').find((r) => r.field === 'Last name');
    suite.check('React: a controlled input that rejects input reports "failed", not "filled"', locked?.status === 'failed' && locked?.reason === 'page did not keep the value');

    // ---- Lever-style fixture ----
    const lever = await browser.open(uniqueUrl(`${server.origin}/lever-like.html`));
    pages.push(lever);
    await browser.injectAndFill(ext, lever.url);
    const lv = await lever.evaluate(`Object.fromEntries(['name','email','phone','urls[LinkedIn]','urls[GitHub]','urls[Portfolio]','urls[Twitter]','org'].map((n) => [n, document.querySelector('[name="' + n + '"]').value]))`);
    suite.check('Lever-style: the six standard fields filled with the right values; Twitter and company left empty',
      lv.name === 'Ada Lovelace' && lv.email === TEST_PROFILE.email && lv.phone === TEST_PROFILE.phone && lv['urls[LinkedIn]'] === TEST_PROFILE.linkedin
      && lv['urls[GitHub]'] === TEST_PROFILE.github && lv['urls[Portfolio]'] === TEST_PROFILE.website && lv['urls[Twitter]'] === '' && lv.org === '', JSON.stringify(lv));
    const touched = await lever.evaluate(`[...document.querySelectorAll('[name^="cards["], [name^="eeo["]')].filter((e) => e.type !== 'hidden')
      .filter((e) => (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value).map((e) => e.name)`);
    suite.check('Lever-style: no custom-question card or EEO field touched (nothing saved for them)', touched.length === 0, JSON.stringify(touched));

    // ---- guards, called directly with crafted instructions ----
    const guards = await browser.open(uniqueUrl(`${server.origin}/filler-cases.html`));
    await guards.evaluate(fillerBundle);
    const g = await guards.evaluate(`(async () => {
      const base = { key: 'email', value: 'x@example.com', confidence: 0.9, source: 'dictionary', requiresReview: false };
      return (await window.__applyFill([
        { ...base, fieldId: 'pw', selector: '#pw' },
        { ...base, fieldId: 'bad', selector: '#[' },
        { ...base, fieldId: 'gone', selector: '#nope' },
      ])).map((r) => r.status + ': ' + r.reason);
    })()`);
    suite.check('guards: a selector now pointing at a password field, a malformed selector, a missing element: all skipped',
      JSON.stringify(g) === JSON.stringify(['skipped: element is not a fillable text field', 'skipped: element not found', 'skipped: element not found']), JSON.stringify(g));

    await sleep(300);
    const leaked = leakedValues(pages);
    suite.check('no text profile value in any console output (dev build)', leaked.length === 0, leaked.join(', '));
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
