// Step 8: the real popup, opened over a tab with chrome.action.openPopup().
// Permissions and install warnings on the unmodified build; then click → inject
// once → fill → the popup closes itself when the overlay appears, or stays open
// with the reason when nothing was filled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extensionWithHostAccess, launchChrome, leakedValues, serveFixtures, sleep, Suite, TEST_PROFILE } from './lib/harness.mjs';

const popupUrl = (ext) => `chrome-extension://${ext.id}/popup/popup.html`;

/** Navigate (optionally), open the real popup over the tab, click Fill. status = the popup's text, or 'closed'. */
async function clickFill(browser, ext, tab, url, popupConsoles) {
  if (url) {
    await browser.send('Page.navigate', { url }, tab.sessionId);
    await sleep(1200);
  }
  const opened = await ext.sw.evaluate(`chrome.action.openPopup().then(() => 'ok', (e) => e.message)`);
  await sleep(800);
  const target = (await browser.targets()).find((t) => t.url === popupUrl(ext));
  if (!target) return { opened, status: null };
  const popup = await browser.attach(target.targetId);
  popupConsoles.push(popup);
  await popup.evaluate(`document.getElementById('fill').click()`).catch(() => {});
  let status = null, kind = null;
  for (let i = 0; i < 30 && status === null; i++) {
    await sleep(150);
    if (!(await browser.targets()).some((t) => t.url === popupUrl(ext))) { status = 'closed'; break; }
    const text = await popup.evaluate(`document.getElementById('status').textContent`).catch(() => null);
    if (text && text !== 'Filling…') { status = text; kind = await popup.evaluate(`document.getElementById('status').className`); }
  }
  if (status !== 'closed') await browser.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
  return { opened, status, kind };
}

export async function run({ devDist }) {
  const suite = new Suite('popup');
  const server = await serveFixtures({ '/no-form.html': '<!doctype html><h1>Just an article</h1><p>No form here.</p>' });
  const manifestText = readFileSync(join(devDist, 'manifest.json'), 'utf8');

  // ---- real, unmodified build ----
  let browser = await launchChrome();
  try {
    const real = await browser.loadExtension(devDist);
    const perms = await real.sw.evaluate(`chrome.permissions.getAll()`);
    suite.check('permissions: activeTab + scripting + storage; zero host origins', JSON.stringify([...perms.permissions].sort()) === '["activeTab","scripting","storage"]' && perms.origins.length === 0, JSON.stringify(perms));
    const warnings = await real.sw.evaluate(`chrome.management.getPermissionWarningsByManifest(${JSON.stringify(manifestText)})`);
    suite.check('Chrome reports no install permission warnings', Array.isArray(warnings) && warnings.length === 0, JSON.stringify(warnings));
    suite.check('no leftover toolbar-click handler', (await real.sw.evaluate(`chrome.action.onClicked.hasListeners()`)) === false);
    const m = JSON.parse(manifestText);
    suite.check('manifest: popup registered; no content_scripts / host_permissions', m.action.default_popup === 'popup/popup.html' && !m.content_scripts && !m.host_permissions);
    const tab = await browser.open(`${server.origin}/filler-cases.html`);
    const r = await clickFill(browser, real, tab, null, []);
    suite.check('real popup opens; opened programmatically (no click → no activeTab) it says it can’t access the page',
      r.opened === 'ok' && r.status === "Chrome doesn't let extensions fill this page.", `${r.opened} / ${r.status}`);
  } finally {
    browser.close();
  }

  // ---- host-access copy (stands in for the click's activeTab grant) ----
  browser = await launchChrome();
  const popupConsoles = [];
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist));
    suite.check('test profile saved', (await browser.saveProfile(ext, TEST_PROFILE))?.ok === true);
    // Exactly one page tab, so it's the active tab under the popup.
    for (const t of (await browser.targets()).filter((t) => t.type === 'page')) await browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const tab = await browser.attach(targetId);

    const lever = await clickFill(browser, ext, tab, `${server.origin}/lever-like.html`, popupConsoles);
    const overlayVisible = await tab.evaluate(`(() => { const h = document.querySelector('job-autofill-overlay'); return !!h && h.checkVisibility(); })()`);
    const name = await tab.evaluate(`document.querySelector('[name="name"]').value`);
    suite.check('Lever-style: click → fill → popup closes itself → overlay fully visible', lever.status === 'closed' && overlayVisible && name === 'Ada Lovelace', lever.status);

    const fx1 = await clickFill(browser, ext, tab, `${server.origin}/filler-cases.html`, popupConsoles);
    const fx2 = await clickFill(browser, ext, tab, null, popupConsoles);
    suite.check('second click on a filled page: popup stays open and says why',
      fx1.status === 'closed' && fx2.status === 'Nothing to fill: those fields are already filled or hidden.' && fx2.kind === 'done', JSON.stringify([fx1.status, fx2.status]));
    const scans = tab.consoleCalls.filter((c) => String(c.args[1]).startsWith('scan:')).length;
    suite.check('content script injected once per page (one scan per click)', scans === 3, `${scans} scans for 3 clicks`);

    const none = await clickFill(browser, ext, tab, `${server.origin}/no-form.html`, popupConsoles);
    suite.check('page without a form', none.status === 'No form fields found on this page.', none.status);
    const blocked = await clickFill(browser, ext, tab, 'chrome://version', popupConsoles);
    suite.check('browser pages: friendly error', blocked.status === "Chrome doesn't let extensions fill this page." && blocked.kind === 'error', blocked.status);

    await sleep(300);
    suite.check('popup console stays empty', popupConsoles.every((p) => p.consoleCalls.length === 0));
    const leaked = leakedValues([tab, ...popupConsoles]);
    suite.check('no text profile value in any console output', leaked.length === 0, leaked.join(', '));
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
