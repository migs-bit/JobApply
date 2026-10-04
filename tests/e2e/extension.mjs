// Steps 1-4: manifest and CSP accepted by Chrome, options page saves/loads,
// message guard, sanitizing, and zero network access. Uses the production build
// with the real, unmodified manifest.
import http from 'node:http';
import { launchChrome, sleep, Suite } from './lib/harness.mjs';

export async function run({ prodDist }) {
  const suite = new Suite('extension shell, options page, CSP');
  const browser = await launchChrome();
  // Canary: any request reaching this server means the CSP let network traffic out.
  let hits = 0;
  const canary = http.createServer((_q, r) => { hits++; r.end('reached'); });
  await new Promise((r) => canary.listen(0, '127.0.0.1', r));
  const CANARY = `http://127.0.0.1:${canary.address().port}/x`;

  try {
    const ext = await browser.loadExtension(prodDist);
    suite.check('extension loads (manifest + CSP accepted)', !!ext.id);
    const targets = await browser.targets();
    suite.check('options page opens on install', targets.some((t) => t.url.startsWith(`chrome-extension://${ext.id}/options/`)));

    const page = await browser.open(`chrome-extension://${ext.id}/options/options.html`, 1500);
    const ev = page.evaluate;
    const msg = (m) => ev(`chrome.runtime.sendMessage(${JSON.stringify(m)})`);

    const shape = await ev(`({ controls: document.querySelectorAll('section input, section select').length,
      ai: document.querySelector('fieldset').disabled && document.querySelectorAll('fieldset input, fieldset select').length })`);
    suite.check('options page renders all 22 profile controls + the disabled AI section', shape.controls === 22 && shape.ai === 2, JSON.stringify(shape));

    // Type into the React-controlled form like a user, then save.
    const setField = `(label, v) => { const el = [...document.querySelectorAll('label')].find((l) => l.firstChild.textContent.trim() === label).querySelector('input, select');
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); }`;
    await ev(`(() => { const set = ${setField}; set('First name', 'Ada'); set('Last name', 'Lovelace'); set('Email', 'ada@example.com');
      set('Phone', '+1 (555) 010-0100'); set('LinkedIn', 'linkedin.com/in/ada'); document.querySelector('button[type=submit]').click(); })()`);
    await sleep(800);
    const status = await ev(`document.querySelector('[role=status]').textContent`);
    suite.check('UI save succeeds', status.includes('Saved'), status);
    const linkedin = await ev(`[...document.querySelectorAll('label')].find((l) => l.firstChild.textContent.trim() === 'LinkedIn').querySelector('input').value`);
    suite.check('URL normalized to https:// and shown in the form', linkedin === 'https://linkedin.com/in/ada', linkedin);

    await browser.send('Page.reload', {}, page.sessionId);
    await sleep(1500);
    const reloaded = await ev(`[...document.querySelectorAll('section input')].slice(0, 4).map((i) => i.value)`);
    suite.check('profile persists across reload', JSON.stringify(reloaded) === JSON.stringify(['Ada', 'Lovelace', 'ada@example.com', '+1 (555) 010-0100']), JSON.stringify(reloaded));

    await ev(`(() => { const set = ${setField}; set('Email', 'not-an-email'); document.querySelector('button[type=submit]').click(); })()`);
    await sleep(300);
    suite.check('inline error for a bad email', (await ev(`document.querySelector('#err-email')?.textContent ?? ''`)).length > 0);

    // ---- message guard + sanitizing ----
    const js = await msg({ type: 'SET_PROFILE', profile: { website: 'javascript:alert(1)' } });
    suite.check('rejects javascript: URLs', js.ok === false && !!js.fieldErrors?.website);
    const data = await msg({ type: 'SET_PROFILE', profile: { github: 'data:text/html,hi' } });
    suite.check('rejects data: URLs', data.ok === false && !!data.fieldErrors?.github);
    const malformed = await Promise.all([msg({ type: 'NOPE' }), msg('hello'), msg({ type: 'SET_PROFILE', profile: 'x' }), msg(null)]);
    suite.check('rejects malformed messages', malformed.every((r) => r.ok === false && r.error === 'Malformed message'));
    const wrongSender = await msg({ type: 'RESOLVE_FIELDS', fields: [] });
    suite.check('RESOLVE_FIELDS refused from an extension page (content scripts only)', wrongSender.error === 'Not allowed');
    const tooMany = await msg({ type: 'RESOLVE_FIELDS', fields: Array.from({ length: 501 }, (_, i) => ({ id: `f${i}`, selector: '#x', tag: 'input' })) });
    suite.check('more than 500 fields rejected as malformed', tooMany.error === 'Malformed message');
    const clean = await msg({ type: 'SET_PROFILE', profile: { firstName: '  Ada\u0000‮  ', lastName: 42, city: 'x'.repeat(10_000), isAdmin: true } });
    const got = await msg({ type: 'GET_PROFILE' });
    suite.check(
      'sanitizes: control/bidi chars stripped, non-strings and unknown keys dropped, length capped',
      clean.ok && got.data.firstName === 'Ada' && got.data.lastName === '' && got.data.city.length === 500 && !('isAdmin' in got.data) && Object.keys(got.data).length === 22,
    );

    // ---- CSP: no network, no inline script ----
    const pageFetch = await ev(`fetch('${CANARY}').then(() => 'allowed', (e) => 'blocked')`);
    const swFetch = await ext.sw.evaluate(`fetch('${CANARY}').then(() => 'allowed', (e) => 'blocked')`);
    const inline = await ev(`(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.body.append(s); return window.__ran === 1 ? 'ran' : 'blocked'; })()`);
    suite.check('CSP blocks fetch from the options page and the service worker', pageFetch === 'blocked' && swFetch === 'blocked');
    suite.check('canary server received zero requests', hits === 0, `hits=${hits}`);
    suite.check('CSP blocks inline scripts', inline === 'blocked');

    const web = await browser.open('data:text/html,<p>web page</p>', 600);
    suite.check('web pages have no channel to the extension', (await web.evaluate(`typeof globalThis.chrome?.runtime?.sendMessage`)) === 'undefined');

    const unexpected = page.logEntries.filter((l) => !/127\.0\.0\.1|inline script|Content Security Policy|Failed to fetch/i.test(l));
    suite.check('no unexpected console errors on the options page', unexpected.length === 0, unexpected.join(' | '));
  } finally {
    browser.close();
    canary.close();
  }
  return suite;
}
