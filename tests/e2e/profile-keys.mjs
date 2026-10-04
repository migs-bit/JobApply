// Phase 1 profile keys + dropdown synonym matching: options page, eeo-cases.html
// (each control declares data-expect-fill), the Lever-style EEO section, and the
// per-<select> diagnostics. With --live: a real Lever posting with an EEO section.
import { extensionWithHostAccess, inOverlay, launchChrome, leakedValues, serveFixtures, sleep, Suite, tableAfter, TEST_PROFILE, uniqueUrl } from './lib/harness.mjs';

const PROFILE = {
  ...TEST_PROFILE,
  desiredSalary: '120,000 USD', noticePeriod: '2 weeks',
  workAuthorization: 'Yes', requiresSponsorship: 'No', willingToRelocate: 'Yes',
  gender: 'decline', race: 'asian', veteranStatus: 'not_veteran',
};
const LIVE_LEVER_EEO = 'https://jobs.lever.co/wisecode/390e192c-a84b-4e75-918d-fa2e2b4cdde1/apply';

export async function run({ devDist, live }) {
  const suite = new Suite('profile keys + dropdown synonyms');
  const server = await serveFixtures();
  const browser = await launchChrome();
  const pages = [];
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist, ['http://127.0.0.1/*', 'https://jobs.lever.co/*']));

    // ---- options page ----
    const opt = await browser.open(`chrome-extension://${ext.id}/options/options.html`, 1500);
    const ui = await opt.evaluate(`({
      headings: [...document.querySelectorAll('h2')].map((h) => h.textContent),
      selects: [...document.querySelectorAll('section select')].map((s) => [...s.options].map((o) => o.value).join('|')),
    })`);
    suite.check('options page: new sections; 7 choice dropdowns whose values are codes',
      ['Job preferences', 'Work eligibility', 'Voluntary self-identification'].every((h) => ui.headings.includes(h))
      && ui.selects.length === 7 && ui.selects.filter((v) => v === '|Yes|No').length === 3 && ui.selects.includes('|not_veteran|protected_veteran|decline'),
      JSON.stringify(ui.selects));
    await opt.evaluate(`(() => {
      const set = (label, v) => { const el = [...document.querySelectorAll('label')].find((l) => l.firstChild.textContent.trim() === label).querySelector('input, select');
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); };
      set('Gender', 'decline'); set('Need visa sponsorship, now or later?', 'No'); set('Desired salary', '120,000 USD');
      document.querySelector('button[type=submit]').click(); })()`);
    await sleep(700);
    const saved = await opt.evaluate(`chrome.runtime.sendMessage({ type: 'GET_PROFILE' })`);
    suite.check('options page: choice and text values save through the UI', saved.ok && saved.data.gender === 'decline' && saved.data.requiresSponsorship === 'No' && saved.data.desiredSalary === '120,000 USD');
    const bad = await opt.evaluate(`chrome.runtime.sendMessage({ type: 'SET_PROFILE', profile: { willingToRelocate: 'definitely' } })`);
    suite.check('service worker rejects a value that isn’t one of the key’s codes', bad.ok === false && !!bad.fieldErrors?.willingToRelocate);
    suite.check('full test profile saved', (await opt.evaluate(`chrome.runtime.sendMessage({ type: 'SET_PROFILE', profile: ${JSON.stringify(PROFILE)} })`))?.ok === true);

    // ---- eeo-cases.html ----
    const fx = await browser.open(uniqueUrl(`${server.origin}/eeo-cases.html`));
    pages.push(fx);
    const reply = await browser.injectAndFill(ext, fx.url);
    const outcomes = await fx.evaluate(`[...document.querySelectorAll('[data-expect-fill]')].map((el) => ({ name: el.name, want: el.dataset.expectFill, value: el.value }))`);
    const wrong = outcomes.filter((o) => (o.want === 'filled' ? !o.value : !!o.value));
    suite.check('eeo-cases: every control has its expected outcome (fills, safeguards, ambiguous/no-match skips)', reply?.ok && wrong.length === 0, JSON.stringify(wrong));
    const v = Object.fromEntries(outcomes.map((o) => [o.name, o.value]));
    suite.check('eeo-cases: synonym matching picks the right options',
      v['eeo[gender]'] === 'Decline to self-identify' && v.veteran === 'I am not a protected veteran' && v['cards[a1][field0]'] === 'Yes' && v['cards[a2][field0]'] === 'No',
      JSON.stringify({ gender: v['eeo[gender]'], veteran: v.veteran }));
    const diag = tableAfter(fx, 'selects:');
    const row = (field) => diag.find((r) => r.field === field) ?? {};
    suite.check('select diagnostics: matched option, reasons, and available options',
      row('Veteran status')['matched option'] === 'I am not a protected veteran' && row('Veteran status').reason === ''
      && row('Race').reason === 'no option matched' && row('Race')['available options'].includes('East Asian')
      && row('Gender identity').reason === 'multiple matches' && row('Country of citizenship').reason === 'no matching profile key',
      JSON.stringify(diag.map((r) => [r.field.slice(0, 20), r.status, r.reason || r['matched option']])));
    const rows = (await inOverlay(browser, fx, 'li')).results;
    const reviewed = (needle) => rows.find((r) => r.text.includes(needle))?.cls.includes('review');
    suite.check('overlay: EEO, eligibility and salary always flagged for review; notice period not',
      reviewed('gender ·') && reviewed('requiresSponsorship ·') && reviewed('desiredSalary · 90%') && reviewed('noticePeriod · 90%') === false);

    // ---- Lever-style EEO section ----
    const lever = await browser.open(uniqueUrl(`${server.origin}/lever-like.html`));
    pages.push(lever);
    await browser.injectAndFill(ext, lever.url);
    const lv = await lever.evaluate(`({ gender: document.querySelector('[name="eeo[gender]"]').value, race: document.querySelector('[name="eeo[race]"]').value,
      veteran: document.querySelector('[name="eeo[veteran]"]').value, sponsorship: document.querySelector('[name="cards[c1][field3]"]').value,
      radios: [...document.querySelectorAll('input[type=radio]')].filter((r) => r.checked).length })`);
    suite.check('Lever-style: EEO selects and the sponsorship card select filled; radios still untouched',
      lv.gender === 'Decline to self-identify' && lv.race === 'Asian (Not Hispanic or Latino)' && lv.veteran === 'I am not a veteran' && lv.sponsorship === 'No' && lv.radios === 0, JSON.stringify(lv));

    if (live) {
      const page = await browser.open(LIVE_LEVER_EEO, 5000);
      pages.push(page);
      const hasEeo = await page.evaluate(`!!document.querySelector('[name="eeo[veteran]"]')`);
      if (!hasEeo) {
        console.log(`  SKIP  LIVE Lever EEO: posting has no EEO section anymore (${LIVE_LEVER_EEO})`);
      } else {
        await browser.injectAndFill(ext, LIVE_LEVER_EEO);
        const read = () => page.evaluate(`['eeo[gender]','eeo[race]','eeo[veteran]'].map((n) => document.querySelector('[name="' + n + '"]').value)`);
        const now = await read();
        await page.evaluate(`document.activeElement?.blur(); document.body.click();`);
        await sleep(2500);
        const later = await read();
        suite.check('LIVE Lever: gender, race, veteran filled and still set after blur', now.every(Boolean) && JSON.stringify(now) === JSON.stringify(later), JSON.stringify(later));
      }
    }

    const leaked = leakedValues(pages, [PROFILE.email, PROFILE.phone, PROFILE.desiredSalary, PROFILE.noticePeriod]);
    suite.check('no text profile value in any console output', leaked.length === 0, leaked.join(', '));
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
