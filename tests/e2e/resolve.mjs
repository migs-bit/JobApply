// Steps 6 and 10: content script → RESOLVE_FIELDS → service worker → resolutions.
// Offline: the sample form and the Lever-style fixture. With --live: real Lever,
// Ashby and Replit postings, read-only (no profile is saved, so nothing is filled).
import { debugValue, extensionWithHostAccess, launchChrome, serveFixtures, Suite, uniqueUrl } from './lib/harness.mjs';

const keyByName = (page) => {
  const fields = debugValue(page, 'fields') ?? [];
  const resolutions = debugValue(page, 'resolutions') ?? [];
  return { fields, resolutions, key: (name) => resolutions.find((r) => fields.find((f) => f.id === r.fieldId)?.name === name)?.key };
};

async function discoverLivePostings() {
  const json = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  const urls = [];
  const lever = await json('https://api.lever.co/v0/postings/palantir?mode=json&limit=1').catch(() => []);
  if (lever[0]?.applyUrl) urls.push({ site: 'Lever', url: lever[0].applyUrl, wait: 3500 });
  for (const board of ['ashby', 'replit']) {
    const ashby = await json(`https://api.ashbyhq.com/posting-api/job-board/${board}`).catch(() => ({}));
    const job = ashby.jobs?.[0];
    if (job?.jobUrl) urls.push({ site: `Ashby (${board})`, url: `${job.jobUrl}/application`, wait: 6000 });
  }
  return urls;
}

export async function run({ devDist, live }) {
  const suite = new Suite('resolve');
  const server = await serveFixtures();
  const browser = await launchChrome();
  const origins = ['http://127.0.0.1/*', 'https://jobs.lever.co/*', 'https://jobs.ashbyhq.com/*'];
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist, origins)); // no profile saved

    const sample = await browser.open(uniqueUrl(`${server.origin}/index.html`));
    await browser.injectAndFill(ext, sample.url);
    const s = keyByName(sample);
    suite.check('content script → RESOLVE_FIELDS → service worker round trip', s.fields.length > 0 && s.resolutions.length === s.fields.length);
    suite.check('sample form resolves the expected keys',
      s.key('first_name') === 'firstName' && s.key('lname') === 'lastName' && s.key('applicant_email') === 'email' && s.key('contact') === 'phone' && s.key('profile_url') === 'linkedin' && s.key('why') === 'unknown');
    suite.check('resolutions never carry profile values', s.resolutions.every((r) => Object.keys(r).sort().join() === 'confidence,evidence,fieldId,key,source'));

    const lever = await browser.open(uniqueUrl(`${server.origin}/lever-like.html`));
    await browser.injectAndFill(ext, lever.url);
    const l = keyByName(lever);
    suite.check('Lever-style standard fields',
      l.key('name') === 'fullName' && l.key('email') === 'email' && l.key('phone') === 'phone' && l.key('urls[LinkedIn]') === 'linkedin' && l.key('urls[GitHub]') === 'github' && l.key('urls[Portfolio]') === 'website',
      JSON.stringify({ name: l.key('name'), li: l.key('urls[LinkedIn]'), portfolio: l.key('urls[Portfolio]') }));
    suite.check('Twitter URL and current company stay unknown', l.key('urls[Twitter]') === 'unknown' && l.key('org') === 'unknown');
    suite.check('Lever-style cards: sponsorship select and EEO selects resolve; custom questions stay unknown',
      l.key('cards[c1][field3]') === 'requiresSponsorship' && l.key('eeo[gender]') === 'gender' && l.key('eeo[race]') === 'race' && l.key('eeo[veteran]') === 'veteranStatus' && l.key('cards[c1][field4]') === 'unknown');
    const radioCards = l.fields.filter((f) => f.type === 'radio');
    suite.check('Lever-style radio card: one field per group, resolved from its question (not its "Yes"/"No" labels)',
      radioCards.length === 1 && radioCards[0].options?.join('|') === 'Yes|No' && l.key('cards[c1][field2]') === 'workAuthorization');
    const cards = l.fields.filter((f) => f.name.startsWith('cards[') && ['checkbox', 'radio', 'file'].includes(f.type));
    suite.check('card controls get the question as nearby text (not option labels / "Upload file")',
      cards.length > 0 && cards.every((f) => f.nearbyText && !/^(upload file|attach)/i.test(f.nearbyText) && !(f.label && f.nearbyText.startsWith(f.label))));

    if (live) {
      for (const { site, url, wait } of await discoverLivePostings()) {
        const page = await browser.open(url, wait);
        await browser.injectAndFill(ext, url);
        const r = keyByName(page);
        const byId = new Map(r.fields.map((f) => [f.id, f]));
        const falseWebsite = r.resolutions.filter((x) => x.key === 'website').map((x) => byId.get(x.fieldId))
          .filter((f) => !/web ?site|portfolio|personal/i.test([f.label, f.ariaLabel, f.name, f.placeholder].join(' ')));
        const fuzzy = r.resolutions.filter((x) => x.source === 'fuzzy');
        suite.check(`LIVE ${site}: scanned and resolved, no false "website" matches, fuzzy capped at 0.6`,
          r.fields.length > 0 && falseWebsite.length === 0 && fuzzy.every((x) => x.confidence <= 0.6),
          `${r.fields.length} fields, ${r.resolutions.filter((x) => x.key !== 'unknown').length} matched, ${fuzzy.length} fuzzy`);
      }
    }
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
