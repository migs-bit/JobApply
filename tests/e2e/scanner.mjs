// Step 5: the DOM scanner, on test-page/scanner-cases.html. Every control there
// declares its expected result (data-expect-*). Also: no injection without the
// user's click, prefilled values never read, stable ids, production build silent.
import { debugValue, extensionWithHostAccess, launchChrome, serveFixtures, Suite, tableAfter, uniqueUrl } from './lib/harness.mjs';

export async function run({ devDist, prodDist }) {
  const suite = new Suite('scanner');
  const server = await serveFixtures();
  const browser = await launchChrome();
  try {
    // Real build, real manifest: without a click there's no activeTab grant, so no access.
    const real = await browser.loadExtension(devDist);
    const page = await browser.open(uniqueUrl(`${server.origin}/scanner-cases.html`));
    const probe = await real.sw.evaluate(`(async () => {
      const out = [];
      for (const t of await chrome.tabs.query({})) out.push(await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).then(() => 'INJECTED', (e) => e.message));
      return out; })()`);
    suite.check('without a click the extension cannot inject into any page', probe.length > 0 && probe.every((o) => o !== 'INJECTED'));
    const manifest = await real.sw.evaluate(`(() => { const m = chrome.runtime.getManifest(); return !m.content_scripts && !m.host_permissions; })()`);
    suite.check('manifest has no content_scripts and no host_permissions', manifest === true);

    const dev = await browser.loadExtension(extensionWithHostAccess(devDist));
    const prod = await browser.loadExtension(extensionWithHostAccess(prodDist));

    const scan = async () => {
      page.consoleCalls.length = 0;
      const reply = await browser.injectAndFill(dev, page.url);
      return { reply, fields: debugValue(page, 'fields') ?? [], skipped: tableAfter(page, 'skipped') };
    };
    const first = await scan();
    suite.check('dev build logs the scan (summary, fields, skipped table)', first.reply?.ok === true && first.fields.length > 0);

    const failures = await page.evaluate(`((fields, skipped) => {
      const f = [], byEl = new Map();
      for (const x of fields) {
        const els = document.querySelectorAll(x.selector);
        if (els.length !== 1) f.push('selector not unique: ' + x.selector); else byEl.set(els[0], x);
      }
      for (const el of document.querySelectorAll('[data-expect-skip],[data-expect-label],[data-expect-nearby],[data-expect-nearby-not],[data-expect-type],[data-expect-grouped]')) {
        const x = byEl.get(el), who = el.name || el.type, d = el.dataset;
        if (d.expectGrouped !== undefined) {
          const first = document.querySelector('input[type=radio][name="' + el.name + '"]');
          if (x) f.push(who + ': later radio reported on its own (should be part of its group)');
          if (!byEl.get(first)) f.push(who + ': its group was not reported');
          continue;
        }
        if (d.expectSkip !== undefined) {
          if (x) f.push(who + ': should be skipped (' + d.expectSkip + ')');
          else if (el.name && !skipped.some((s) => s.name === el.name && s.reason === d.expectSkip)) f.push(who + ': skipped for the wrong reason');
          continue;
        }
        if (!x) { f.push(who + ': not detected'); continue; }
        if (d.expectLabel !== undefined && x.label !== d.expectLabel) f.push(who + ': label ' + JSON.stringify(x.label));
        if (d.expectNearby !== undefined && (d.expectNearby === '' ? x.nearbyText !== '' : !x.nearbyText.includes(d.expectNearby))) f.push(who + ': nearbyText ' + JSON.stringify(x.nearbyText));
        if (d.expectNearbyNot !== undefined && x.nearbyText.includes(d.expectNearbyNot)) f.push(who + ': nearbyText contains ' + JSON.stringify(d.expectNearbyNot));
        if (d.expectType !== undefined && x.type !== d.expectType) f.push(who + ': type ' + x.type);
        if (d.expectOptions !== undefined && (x.options ?? []).join('|') !== d.expectOptions) f.push(who + ': options ' + JSON.stringify(x.options));
      }
      return f;
    })(${JSON.stringify(first.fields)}, ${JSON.stringify(first.skipped)})`);
    suite.check('every fixture expectation holds (labels, nearby text, types, skips, selectors)', Array.isArray(failures) && failures.length === 0, JSON.stringify(failures));

    suite.check('iframe and shadow-DOM fields are not scanned', !first.fields.some((x) => /in-iframe|in-shadow/.test(x.name)));
    suite.check('the iframe blind spot is reported in the log', page.consoleCalls.some((c) => /iframe\(s\) on this page were not scanned/.test(c.args[1])));
    suite.check('field values are never read (prefilled values absent from all output)', !JSON.stringify(page.consoleCalls).includes('PREFILLED-SECRET'));
    const dups = first.fields.filter((x) => x.name === 'dup1' || x.name === 'dup2');
    suite.check('duplicate-id inputs get distinct, non-#id selectors', dups.length === 2 && dups[0].selector !== dups[1].selector && !dups.some((x) => x.selector === '#dup'));
    suite.check('field ids are unique', new Set(first.fields.map((x) => x.id)).size === first.fields.length);
    const radios = first.fields.filter((x) => x.type === 'radio');
    suite.check('a radio group is reported as one field with its options', radios.length === 1 && radios[0].options?.join('|') === 'Yes|No', JSON.stringify(radios.map((x) => [x.name, x.options])));

    const second = await scan();
    suite.check('ids and selectors are stable across re-scans', JSON.stringify(second.fields.map((x) => [x.id, x.selector])) === JSON.stringify(first.fields.map((x) => [x.id, x.selector])));

    page.consoleCalls.length = 0;
    const prodReply = await browser.injectAndFill(prod, page.url);
    suite.check('production build: runs and logs nothing', prodReply?.ok === true && page.consoleCalls.length === 0, `${page.consoleCalls.length} console calls`);
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
