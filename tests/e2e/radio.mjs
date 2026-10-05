// Phase 2: radio groups. test-page/radio-cases.html declares each group's
// expected outcome on its first radio (data-expect-fill / data-expect-choice).
// Plus React radios (real click → state; refused click → "page reverted"), Undo,
// review highlighting, and, with --live, a real Lever form's radio questions.
import { join } from 'node:path';
import {
  bundleIife, clickInOverlay, extensionWithHostAccess, inOverlay, launchChrome, leakedValues, overlayPresent, RESULT_ROWS, ROOT, serveFixtures, sleep, Suite,
  tableAfter, TEST_PROFILE, UNDO_BUTTON, uniqueUrl,
} from './lib/harness.mjs';

const PROFILE = {
  ...TEST_PROFILE,
  workAuthorization: 'Yes', requiresSponsorship: 'No', willingToRelocate: 'Yes',
  gender: 'female', race: 'asian', veteranStatus: 'not_veteran', disabilityStatus: 'decline',
};
const LIVE_LEVER = 'https://jobs.lever.co/wisecode/390e192c-a84b-4e75-918d-fa2e2b4cdde1/apply';
/** Label of the checked radio in each group, by name. */
const CHECKED = `Object.fromEntries([...new Set([...document.querySelectorAll('input[type=radio]')].map((r) => r.name))].map((n) => {
  const c = [...document.querySelectorAll('input[type=radio]')].find((r) => r.name === n && r.checked);
  return [n, c ? ((c.labels?.[0] ?? c.closest('label'))?.textContent.trim() ?? c.value) : null]; }))`;

export async function run({ devDist, live }) {
  const suite = new Suite('radio groups');
  const reactRadio = await bundleIife(join(ROOT, 'tests/e2e/fixtures/react-radio.tsx'));
  const server = await serveFixtures({
    '/react-radio.html': '<!doctype html><div id="root"></div><script src="react-radio.js"></script>',
    '/react-radio.js': reactRadio,
  });
  const browser = await launchChrome();
  const pages = [];
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist, ['http://127.0.0.1/*', 'https://jobs.lever.co/*']));
    suite.check('test profile saved', (await browser.saveProfile(ext, PROFILE))?.ok === true);

    // ---- radio-cases.html ----
    const fx = await browser.open(uniqueUrl(`${server.origin}/radio-cases.html`));
    pages.push(fx);
    const reply = await browser.injectAndFill(ext, fx.url);
    const groups = tableAfter(fx, 'radio groups:');
    const checked = await fx.evaluate(CHECKED);
    const expectations = await fx.evaluate(`[...document.querySelectorAll('[data-expect-fill]')].map((el) => ({ name: el.name, type: el.type, want: el.dataset.expectFill, choice: el.dataset.expectChoice ?? null }))`);
    const wrong = [];
    for (const e of expectations) {
      const row = groups.find((g) => g.name === e.name);
      if (e.type === 'checkbox') { if (await fx.evaluate(`document.querySelector('[name="${e.name}"]:checked') !== null`)) wrong.push(`${e.name}: checkbox touched`); continue; }
      if (e.want === 'filled') {
        if (row?.status !== 'filled' || checked[e.name] !== e.choice) wrong.push(`${e.name}: want ${e.choice}, got ${row?.status} / ${checked[e.name]}`);
      } else if (e.want === 'untouched') {
        if (checked[e.name] !== null || (row && row.status !== 'skipped') || (row && row.reason !== 'no matching profile key' && row.key !== 'unknown')) wrong.push(`${e.name}: should be untouched (${JSON.stringify(row)})`);
      } else if (`${row?.status}: ${row?.reason}` !== e.want) {
        wrong.push(`${e.name}: want "${e.want}", got "${row?.status}: ${row?.reason}"`);
      }
    }
    suite.check('every group has its expected outcome (fills, ambiguous / no-match / preselected / hidden skips, untouched questions)', reply?.ok && wrong.length === 0, JSON.stringify(wrong));
    suite.check('a preselected answer is never changed', checked.ca_q === 'No');
    suite.check('diagnostics: one row per group (not per radio), with chosen option and available options',
      groups.length === new Set(groups.map((g) => g.name)).size && groups.find((g) => g.name === 'gender_q')?.['matched option'] === 'Female'
      && groups.find((g) => g.name === 'dis_q')?.['available options'] === 'Yes, I have a disability | No, I do not have a disability',
      `${groups.length} rows`);

    const rows = (await inOverlay(browser, fx, RESULT_ROWS)).results;
    suite.check('overlay: every radio answer flagged for review (all are sensitive keys); shows the chosen option',
      rows.length === 5 && rows.every((r) => r.cls.includes('review')) && rows.some((r) => r.text.includes('Asian (Not Hispanic or Latino)')), rows.map((r) => r.text.slice(0, 30)).join(' | '));
    await sleep(7000);
    suite.check('overlay does not auto-dismiss (answers need review)', await overlayPresent(fx));

    await clickInOverlay(browser, fx, UNDO_BUTTON);
    await sleep(200);
    const afterUndo = await fx.evaluate(CHECKED);
    const undoSummary = (await inOverlay(browser, fx, '.summary')).results[0].text;
    const dimmed = (await inOverlay(browser, fx, RESULT_ROWS)).results.filter((r) => r.cls.includes('undone')).length;
    suite.check('Undo leaves radio answers in place (a programmatic clear would desync React state) and says to change them by hand',
      afterUndo.auth === 'Yes' && afterUndo.gender_q === 'Female' && afterUndo.ca_q === 'No' && dimmed === 0
      && undoSummary === "Restored 0 fields. 5 radio answers can't be cleared automatically: change them on the page.", undoSummary);

    // Undo leaves a group the user changed since filling.
    const fx2 = await browser.open(uniqueUrl(`${server.origin}/radio-cases.html`));
    pages.push(fx2);
    await browser.injectAndFill(ext, fx2.url);
    await fx2.evaluate(`document.querySelector('input[name=auth][value=no]').click()`);
    await clickInOverlay(browser, fx2, UNDO_BUTTON);
    await sleep(200);
    const userKept = await fx2.evaluate(CHECKED);
    const keptSummary = (await inOverlay(browser, fx2, '.summary')).results[0].text;
    suite.check('Undo never touches an answer the user changed after the fill', userKept.auth === 'No' && keptSummary.includes('4 radio answers'), `${userKept.auth} / ${keptSummary}`);

    // ---- React ----
    const react = await browser.open(uniqueUrl(`${server.origin}/react-radio.html`));
    pages.push(react);
    await browser.injectAndFill(ext, react.url);
    const state = await react.evaluate('window.__radioState');
    const reactRows = tableAfter(react, 'radio groups:');
    suite.check('React: the click updates component state (not just the DOM)', state?.auth === 'Yes' && (await react.evaluate(CHECKED)).auth === 'Yes', JSON.stringify(state));
    const refused = reactRows.find((r) => r.name === 'sponsor');
    suite.check('React: a group that refuses the click is reported "failed: page reverted"', refused?.status === 'failed' && refused?.reason === 'page reverted', JSON.stringify(refused));
    await clickInOverlay(browser, react, UNDO_BUTTON);
    await sleep(200);
    const reactUndo = { dom: (await react.evaluate(CHECKED)).auth, state: (await react.evaluate('window.__radioState')).auth };
    suite.check('React: after Undo, what the page shows still matches component state', reactUndo.dom === reactUndo.state, JSON.stringify(reactUndo));

    // ---- regression: Lever-style text, dropdown, and radio fields together ----
    const lever = await browser.open(uniqueUrl(`${server.origin}/lever-like.html`));
    pages.push(lever);
    await browser.injectAndFill(ext, lever.url);
    const lv = await lever.evaluate(`({ name: document.querySelector('[name="name"]').value, gender: document.querySelector('[name="eeo[gender]"]').value,
      veteran: document.querySelector('[name="eeo[veteran]"]').value, auth: ${CHECKED}['cards[c1][field2]'], langs: document.querySelectorAll('[name="cards[c1][field0]"]:checked').length })`);
    suite.check('Lever-style: text + dropdowns still fill; the authorization radio card is answered; checkboxes untouched',
      lv.name === 'Ada Lovelace' && lv.gender === 'Female' && lv.veteran === 'I am not a veteran' && lv.auth === 'Yes' && lv.langs === 0, JSON.stringify(lv));

    if (live) {
      const page = await browser.open(LIVE_LEVER, 5000);
      pages.push(page);
      if (!(await page.evaluate(`!!document.querySelector('input[type=radio]')`))) {
        console.log(`  SKIP  LIVE Lever radios: posting has no radio questions anymore (${LIVE_LEVER})`);
      } else {
        await browser.injectAndFill(ext, LIVE_LEVER);
        const rowsLive = tableAfter(page, 'radio groups:');
        for (const r of rowsLive) console.log(`        ${String(r.field).slice(0, 50).padEnd(50)} key=${String(r.key).padEnd(20)} ${r.status}${r.reason ? ' (' + r.reason + ')' : ''} ${r['matched option'] ? '→ ' + r['matched option'] : ''}`);
        const now = await page.evaluate(CHECKED);
        await page.evaluate(`document.activeElement?.blur(); document.body.click();`);
        await sleep(2500);
        const later = await page.evaluate(CHECKED);
        const filled = rowsLive.filter((r) => r.status === 'filled');
        const unknownTouched = rowsLive.filter((r) => r.key === 'unknown' && now[r.name] !== null);
        suite.check('LIVE Lever: known radio questions answered, custom questions untouched, still set after blur',
          filled.length > 0 && unknownTouched.length === 0 && JSON.stringify(now) === JSON.stringify(later), `${filled.length} filled, ${rowsLive.length} groups`);
        const eeo = await page.evaluate(`['eeo[gender]','eeo[race]','eeo[veteran]'].map((n) => document.querySelector('[name="' + n + '"]')?.value ?? null)`);
        suite.check('LIVE Lever: gender, race, veteran dropdowns still fill (regression)', eeo.every(Boolean), JSON.stringify(eeo));
      }
    }

    const leaked = leakedValues(pages);
    suite.check('no text profile value in any console output', leaked.length === 0, leaked.join(', '));
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
