// Robust fill: the full event sequences, React state on submit, and the post-fill
// verification pass. Fills run with the page *in the background*, as in real use
// (the popup has keyboard focus, so element.focus()/blur() fire nothing there).
// With --live: real Lever and Ashby forms still fill, and nothing reverts.
import { join } from 'node:path';
import {
  bundleIife, extensionWithHostAccess, inOverlay, launchChrome, leakedValues, overlayPresent, RESULT_ROWS, ROOT, serveFixtures, sleep, Suite,
  tableAfter, TEST_PROFILE, uniqueUrl,
} from './lib/harness.mjs';

const TEXT_EVENTS = ['focus (no bubble)', 'focusin', 'keydown[a]', 'input', 'keyup[a]', 'change', 'blur (no bubble)', 'focusout'];
const SELECT_EVENTS = ['focus (no bubble)', 'focusin', 'mousedown', 'mouseup', 'click (option)', 'click', 'input', 'change', 'blur (no bubble)', 'focusout'];

/** Submits the React form in the page (its handler calls preventDefault) and returns what it "sent". */
const submit = (page) => page.evaluate(`(() => { document.getElementById('react-form').requestSubmit(); return window.__submitted; })()`);

export async function run({ devDist, prodDist, live }) {
  const suite = new Suite('robust-fill');
  const reactApp = await bundleIife(join(ROOT, 'tests/e2e/fixtures/react-submit.tsx'));
  const server = await serveFixtures({
    '/react-submit.html': '<!doctype html><div id="root"></div><script src="react-submit.js"></script>',
    '/react-submit.js': reactApp,
  });
  const browser = await launchChrome();
  const pages = [];
  /** Opens `url`, then brings another tab to the front, so the page has no focus while it's filled (like with the popup open). */
  const openInBackground = async (url, wait) => {
    const page = await browser.open(url, wait);
    pages.push(page);
    const front = await browser.open('about:blank', 200);
    await browser.send('Target.activateTarget', { targetId: front.targetId });
    await sleep(200);
    page.hasFocus = await page.evaluate('document.hasFocus()');
    return page;
  };
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist));
    pages.push(ext.sw);
    await browser.saveProfile(ext, TEST_PROFILE);

    // ---- React: state read on submit ----
    const control = await openInBackground(uniqueUrl(`${server.origin}/react-submit.html`));
    await control.evaluate(`(() => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
      set(document.getElementById('s-first'), 'Ada'); set(document.getElementById('s-city'), 'Toronto'); set(document.getElementById('s-state'), 'ON');
    })()`);
    const before = await submit(control);
    suite.check('control: the old input+change-only fill leaves blur-committed state empty (the reported bug, reproduced)',
      !control.hasFocus && before.first === 'Ada' && before.city === '' && before.state === '' && (await control.evaluate('document.getElementById("s-city").value')) === 'Toronto',
      JSON.stringify(before));

    const react = await openInBackground(uniqueUrl(`${server.origin}/react-submit.html`));
    const reactReply = await browser.injectAndFill(ext, react.url);
    const sent = await submit(react);
    suite.check('React controlled inputs: submitted state matches what was filled', sent.first === TEST_PROFILE.firstName && sent.email === TEST_PROFILE.email, JSON.stringify(sent));
    suite.check('React controlled select: submitted state matches', sent.country === 'CA', sent.country);
    suite.check('React fields that commit on blur (input and select): submitted state matches', sent.city === TEST_PROFILE.city && sent.state === 'ON', JSON.stringify(sent));
    suite.check('React onFocus saw every field ("touched")', ['country', 'email', 'first'].every((f) => sent.touched.includes(f)), sent.touched.join(','));
    suite.check('the page was in the background (no focus) during the fill', react.hasFocus === false && reactReply?.data?.filled === 5 && reactReply.data.failed === 0, JSON.stringify(reactReply?.data));

    // ---- exact events on the page; revert after 50 ms ----
    const fx = await openInBackground(uniqueUrl(`${server.origin}/robust-cases.html`));
    fx.reply = await browser.injectAndFill(ext, fx.url);
    const events = await fx.evaluate('window.__events');
    suite.check('text input: the page receives focus, focusin, keydown, input, keyup, change, blur, focusout, in order',
      JSON.stringify(events.first) === JSON.stringify(TEXT_EVENTS), (events.first ?? []).join(' → '));
    suite.check('select: focus, focusin, mousedown, mouseup, click on the option, click, input, change, blur, focusout, in order',
      JSON.stringify(events.country) === JSON.stringify(SELECT_EVENTS), (events.country ?? []).join(' → '));
    suite.check('select: option selected, selectedIndex and value all agree', await fx.evaluate(`(() => { const s = document.getElementById('country');
      return s.value === 'CA' && s.selectedIndex === 1 && s.options[1].selected; })()`));
    const fill = tableAfter(fx, 'fill:');
    const reason = (label) => fill.find((r) => r.field === label);
    suite.check('a value the page reverts after 50 ms is reported failed: "page reverted" (text and select)',
      reason('City')?.status === 'failed' && reason('City')?.reason === 'page reverted' && reason('State')?.reason === 'page reverted'
      && fx.reply?.data?.failed === 2 && fx.reply.data.filled === 3, JSON.stringify(fill.map((r) => [r.field, r.status, r.reason])));
    const rows = (await inOverlay(browser, fx, RESULT_ROWS))?.results ?? [];
    const failedRows = rows.filter((r) => r.cls.includes('failed'));
    suite.check('reverted fields show as yellow review rows', failedRows.length === 2 && failedRows.every((r) => r.cls.includes('review') && r.text.includes('page reverted')),
      rows.map((r) => `${r.cls}: ${r.text.slice(0, 30)}`).join(' | '));
    suite.check('reverted fields are outlined on the page', (await fx.evaluate(`getComputedStyle(document.getElementById('city')).outlineStyle`)) === 'solid');
    const stuck = await fx.evaluate(`[first.value, email.value, country.value]`);
    suite.check('fields that stuck are not flagged', stuck.join() === `${TEST_PROFILE.firstName},${TEST_PROFILE.email},CA` && rows.filter((r) => !r.cls.includes('failed')).length === 3);
    await sleep(7000);
    suite.check('the panel does not auto-dismiss when a field failed', await overlayPresent(fx));

    // ---- dev diagnostics ----
    const table = tableAfter(fx, 'events:');
    const firstRow = table.find((r) => r.key === 'firstName');
    suite.check('dev build: logs key, selector and the event sequence for each field',
      table.length === 5 && firstRow?.selector === '#first' && firstRow.events === 'focus() → set value → focus → focusin → keydown → input → keyup → change → blur() → blur → focusout',
      JSON.stringify(firstRow));
    suite.check('dev build: the event log never includes values or the keys typed', table.every((r) => !r.events.includes('[') && !r.events.includes(TEST_PROFILE.firstName)) && leakedValues(pages).length === 0, leakedValues(pages).join(','));

    // ---- production ----
    const prodExt = await browser.loadExtension(extensionWithHostAccess(prodDist));
    await browser.saveProfile(prodExt, TEST_PROFILE);
    const prodPage = await openInBackground(uniqueUrl(`${server.origin}/react-submit.html`));
    const prodReply = await browser.injectAndFill(prodExt, prodPage.url);
    const prodSent = await submit(prodPage);
    suite.check('production build: same result, and nothing logged', prodReply?.data?.filled === 5 && prodSent.city === TEST_PROFILE.city && prodPage.consoleCalls.length === 0,
      JSON.stringify({ reply: prodReply?.data, prodSent, logs: prodPage.consoleCalls.length }));

    // ---- live: Lever and Ashby still fill, nothing reverts ----
    if (live) {
      const json = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      const targets = [];
      const lever = (await json('https://api.lever.co/v0/postings/palantir?mode=json&limit=1').catch(() => []))[0];
      if (lever?.applyUrl) targets.push({ site: 'Lever', url: lever.applyUrl, wait: 3500 });
      const ashby = (await json('https://api.ashbyhq.com/posting-api/job-board/replit').catch(() => ({}))).jobs?.[0];
      if (ashby?.jobUrl) targets.push({ site: 'Ashby (replit)', url: `${ashby.jobUrl}/application`, wait: 6000 });
      const liveExt = await browser.loadExtension(extensionWithHostAccess(devDist, ['https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*']));
      await browser.saveProfile(liveExt, TEST_PROFILE); // obviously fake data; nothing is ever submitted
      for (const { site, url, wait } of targets) {
        const page = await openInBackground(url, wait);
        const reply = await browser.injectAndFill(liveExt, url);
        const liveFill = tableAfter(page, 'fill:');
        const reverted = liveFill.filter((r) => r.reason === 'page reverted');
        const kept = await page.evaluate(`[...document.querySelectorAll('input[type=email]')].some((i) => i.value === ${JSON.stringify(TEST_PROFILE.email)})`);
        suite.check(`LIVE ${site}: fills, email still there after the verification pass, nothing reverted`,
          reply?.data?.filled > 0 && kept && reverted.length === 0, JSON.stringify({ data: reply?.data, reverted: reverted.map((r) => r.field) }));
      }
      if (targets.length < 2) suite.check('LIVE: found Lever and Ashby postings', false, `found ${targets.map((t) => t.site).join(', ')}`);
    }
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
