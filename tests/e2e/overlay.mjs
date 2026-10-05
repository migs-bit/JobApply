// Step 9: the confirmation overlay. Its shadow root is closed, so it's inspected
// through CDP's DOM domain (pierce), which the page itself can't do.
import { join } from 'node:path';
import {
  bundleIife, clickInOverlay, extensionWithHostAccess, inOverlay, launchChrome, leakedValues, overlayPresent, RESULT_ROWS, ROOT, serveFixtures, sleep, Suite,
  TEST_PROFILE, UNDO_BUTTON, uniqueUrl,
} from './lib/harness.mjs';

const HOSTILE_HTML = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'">
<link rel="stylesheet" href="hostile.css"></head><body><h1>Hostile page</h1><label for="h1">First name</label><input id="h1" name="first_name"></body></html>`;
const HOSTILE_CSS = `* { color: red !important; font-size: 40px !important; font-family: serif !important; }
job-autofill-overlay, section, ul, button { display: none !important; visibility: hidden !important; }`;

export async function run({ devDist }) {
  const suite = new Suite('overlay');
  const reactApp = await bundleIife(join(ROOT, 'tests/e2e/fixtures/react-form.tsx'));
  const server = await serveFixtures({
    '/react.html': '<!doctype html><div id="root"></div><script src="react-app.js"></script>',
    '/react-app.js': reactApp,
    '/hostile.html': HOSTILE_HTML,
    '/hostile.css': HOSTILE_CSS,
  });
  const browser = await launchChrome();
  const pages = [];
  const open = async (path) => {
    const page = await browser.open(uniqueUrl(`${server.origin}/${path}`));
    pages.push(page);
    page.reply = await browser.injectAndFill(ext, page.url);
    return page;
  };
  let ext;
  try {
    ext = await browser.loadExtension(extensionWithHostAccess(devDist));
    await browser.saveProfile(ext, TEST_PROFILE);

    // ---- filler-cases: review rows, no auto-dismiss, undo ----
    const fx = await open('filler-cases.html');
    suite.check('fill reply', fx.reply?.ok && fx.reply.data.filled === 6 && fx.reply.data.needsReview === 2, JSON.stringify(fx.reply?.data));
    suite.check('overlay host in the page; shadow root closed to page scripts',
      (await overlayPresent(fx)) && (await fx.evaluate(`document.querySelector('job-autofill-overlay').shadowRoot === null`)));
    const rows = await inOverlay(browser, fx, RESULT_ROWS);
    suite.check('shadow root type is "closed"', rows?.shadowRootType === 'closed');
    suite.check('one row per filled field', rows.results.length === 6, rows.results.map((r) => r.text.slice(0, 20)).join(' | '));
    const ada = rows.results.find((r) => r.text.startsWith('First name'))?.text ?? '';
    suite.check('rows show label, value, key, confidence %, source tier', ada.includes('Ada') && ada.includes('firstName · 90% · dictionary'), ada);
    const review = rows.results.filter((r) => r.cls.includes('review'));
    const outline = await fx.evaluate(`getComputedStyle(zipvis).outlineStyle + ' ' + getComputedStyle(zipvis).outlineWidth`);
    suite.check('low-confidence rows highlighted and listed first (dictionary-weak + fuzzy), field outlined',
      review.length === 2 && rows.results[0].cls.includes('review') && review.some((r) => r.text.includes('postalCode · 70% · dictionary'))
      && review.some((r) => r.text.includes('phone · 60% · fuzzy')) && outline === 'solid 2px', outline);
    const summary = (await inOverlay(browser, fx, '.summary')).results[0].text;
    suite.check('summary counts', summary === 'Filled 6 fields · 2 to review · 9 skipped · 1 to teach.', summary);
    await sleep(7000);
    suite.check('does not auto-dismiss while something needs review', await overlayPresent(fx));

    await fx.evaluate(`(() => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(fn, 'Edited by user'); fn.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await clickInOverlay(browser, fx, UNDO_BUTTON);
    await sleep(200);
    const after = await fx.evaluate(`({ fn: fn.value, em: em.value, addr: addr.value, country: country.value, zip: zipvis.value, reach: reach.value, ln: ln.value, outline: zipvis.style.outline })`);
    suite.check('Undo restores filled fields, keeps the user’s edit and prefilled values, clears outlines',
      after.fn === 'Edited by user' && after.em === '' && after.addr === '' && after.country === '' && after.zip === '' && after.reach === '' && after.ln === 'Existing' && after.outline === '', JSON.stringify(after));
    const undone = await inOverlay(browser, fx, '.summary, footer button.action');
    suite.check('after Undo: "Restored 5 fields.", Undo hidden', undone.results[0].text === 'Restored 5 fields.' && undone.results[1].hidden === true);
    await inOverlay(browser, fx, 'button.primary', 'function(){ this.click(); }');
    await sleep(100);
    suite.check('Close removes the overlay', !(await overlayPresent(fx)));

    // ---- Escape ----
    const esc = await open('filler-cases.html');
    const before = (await overlayPresent(esc)) && (await esc.evaluate('zipvis.style.outline')) !== '';
    await inOverlay(browser, esc, 'button.primary', 'function(){ this.focus(); }');
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, esc.sessionId);
    await sleep(200);
    suite.check('Escape closes the overlay and restores outlines', before && !(await overlayPresent(esc)) && (await esc.evaluate('zipvis.style.outline')) === '');

    // ---- all high-confidence → auto-dismiss ----
    const lever = await open('lever-like.html');
    const leverRows = await inOverlay(browser, lever, RESULT_ROWS);
    suite.check('Lever-style: six rows, none to review', leverRows?.results.length === 6 && leverRows.results.every((r) => !r.cls.includes('review')));
    await sleep(7000);
    suite.check('auto-dismisses when everything is high-confidence', !(await overlayPresent(lever)));

    // ---- React: failed row; undo resets state ----
    const react = await open('react.html');
    const reactRows = await inOverlay(browser, react, RESULT_ROWS);
    suite.check('React: rejected field shown as "Didn’t stick"', reactRows.results.some((r) => r.cls.includes('failed') && r.text.includes("Didn't stick")));
    await clickInOverlay(browser, react, UNDO_BUTTON);
    await sleep(200);
    const st = await react.evaluate('window.__reactState');
    suite.check('React: Undo resets component state', st.first === '' && st.email === '' && st.country === '', JSON.stringify(st));

    // ---- hostile page ----
    const hostile = await open('hostile.html');
    const look = (await inOverlay(browser, hostile, 'section.panel', `function(){ const cs = getComputedStyle(this);
      return { position: cs.position, fontSize: cs.fontSize, display: cs.display, w: Math.round(this.getBoundingClientRect().width), visible: this.checkVisibility({ visibilityProperty: true }) }; }`))?.results[0];
    suite.check('strict page CSP + hostile CSS: overlay still visible and styled',
      !!look && look.position === 'fixed' && look.fontSize === '13px' && look.display === 'flex' && look.visible && look.w === 360, JSON.stringify(look));

    const leaked = leakedValues(pages);
    suite.check('no text profile value in any console output', leaked.length === 0, leaked.join(', '));
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
