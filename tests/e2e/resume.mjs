// Phase 4: resume upload. Uploads the dummy resume through the real options page
// (PDF.js and mammoth running under the extension's CSP), then attaches it on
// fixture pages: plain, Lever-style hidden input, React, and the cases that must
// be left alone. With --live: a real Lever posting, stopping short of attaching
// (no resume is stored there, so nothing is sent to Lever).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bundleIife, clickInOverlay, extensionWithHostAccess, inOverlay, launchChrome, leakedValues, overlayPresent, RESULT_ROWS, ROOT, serveFixtures,
  sleep, Suite, tableAfter, tempDir, TEST_PROFILE, UNDO_BUTTON, uniqueUrl,
} from './lib/harness.mjs';

const PDF = join(ROOT, 'tests/fixtures/dummy-resume.pdf');
const DOCX = join(ROOT, 'tests/fixtures/dummy-resume.docx');
const PDF_B64 = readFileSync(PDF).toString('base64');

/** Puts real files into a file input, as if the user picked them (CDP; works on hidden inputs too). */
async function setFiles(browser, page, selector, files) {
  const { result } = await browser.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` }, page.sessionId);
  await browser.send('DOM.setFileInputFiles', { files, objectId: result.objectId }, page.sessionId);
}

/** Opens the options page, picks `file` in the Resume section, and waits for the outcome. */
async function uploadViaOptions(browser, ext, file) {
  const page = await browser.open(`chrome-extension://${ext.id}/options/options.html`, 1200);
  const section = `document.getElementById('h-resume').parentElement`;
  await setFiles(browser, page, '[data-testid="resume-picker"]', [file]);
  let status = '';
  for (let i = 0; i < 60 && !/saved|stored|limit|supported|valid|empty/i.test(status); i++) {
    await sleep(250);
    status = await page.evaluate(`${section}.querySelector('.status').textContent`);
  }
  return { page, status, text: await page.evaluate(`${section}.innerText`), summary: await page.evaluate(`chrome.runtime.sendMessage({ type: 'GET_RESUME' })`) };
}

const cspErrors = (page) => [...page.logEntries, ...page.consoleCalls.map((c) => c.args.join(' '))].filter((t) => /Refused to|Content Security Policy|EvalError/i.test(t));

const fileState = (page, id) => page.evaluate(`(async () => {
  const el = document.getElementById(${JSON.stringify(id)}); const f = el?.files?.[0];
  if (!f) return { count: el?.files?.length ?? -1 };
  const bytes = new Uint8Array(await f.arrayBuffer()); let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return { count: el.files.length, name: f.name, type: f.type, size: f.size, b64: btoa(s) };
})()`);

export async function run({ devDist, prodDist, live }) {
  const suite = new Suite('resume');
  const reactApp = await bundleIife(join(ROOT, 'tests/e2e/fixtures/react-resume.tsx'));
  const server = await serveFixtures({
    '/react-resume.html': '<!doctype html><div id="root"></div><script src="react-resume.js"></script>',
    '/react-resume.js': reactApp,
  });
  const scratch = tempDir('resume-files');
  const txt = join(scratch, 'resume.txt');
  const big = join(scratch, 'big-resume.pdf');
  const fake = join(scratch, 'renamed.pdf');
  writeFileSync(txt, 'plain text resume');
  writeFileSync(big, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024)]));
  writeFileSync(fake, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));

  const browser = await launchChrome();
  const pages = [];
  const open = async (ext, path) => {
    const page = await browser.open(uniqueUrl(`${server.origin}/${path}`));
    pages.push(page);
    return page;
  };
  try {
    const ext = await browser.loadExtension(extensionWithHostAccess(devDist));
    pages.push(ext.sw);
    await browser.saveProfile(ext, TEST_PROFILE);

    // ---- options page: validation ----
    const rejectedTxt = await uploadViaOptions(browser, ext, txt);
    pages.push(rejectedTxt.page);
    suite.check('options: .txt rejected with a clear message', rejectedTxt.status === 'Only PDF or DOCX files are supported.' && rejectedTxt.summary?.data === null, rejectedTxt.status);
    const rejectedBig = await uploadViaOptions(browser, ext, big);
    suite.check('options: 6 MB file rejected', /The limit is 5\.0 MB/.test(rejectedBig.status) && rejectedBig.summary?.data === null, rejectedBig.status);
    const rejectedFake = await uploadViaOptions(browser, ext, fake);
    suite.check('options: a PNG renamed to .pdf is rejected by the service worker', /isn't a valid PDF/.test(rejectedFake.status) && rejectedFake.summary?.data === null, rejectedFake.status);

    // ---- options page: DOCX then PDF (Replace) ----
    const docx = await uploadViaOptions(browser, ext, DOCX);
    pages.push(docx.page);
    suite.check('options: DOCX uploaded, text extracted under the extension CSP (mammoth)',
      docx.status === 'Resume saved ✓' && docx.summary?.data?.filename === 'dummy-resume.docx' && docx.summary.data.wordCount > 20, `${docx.status} ${JSON.stringify(docx.summary?.data)}`);
    const pdf = await uploadViaOptions(browser, ext, PDF);
    pages.push(pdf.page);
    const s = pdf.summary?.data;
    suite.check('options: PDF replaces it, text extracted in the bundled PDF.js worker',
      pdf.status === 'Resume saved ✓' && s?.filename === 'dummy-resume.pdf' && s.mimeType === 'application/pdf' && s.size === readFileSync(PDF).length && s.wordCount > 20,
      `${pdf.status} ${JSON.stringify(s)}`);
    suite.check('options: shows filename, size, upload date, word count, Replace and Remove',
      /dummy-resume\.pdf/.test(pdf.text) && /\d+ B|\d+ KB/.test(pdf.text) && /Uploaded/.test(pdf.text) && /\d+ words/.test(pdf.text) && /Replace/.test(pdf.text) && /Remove/.test(pdf.text), pdf.text);
    suite.check('options: summary carries no file bytes or text', s && !('base64' in s) && !('extractedText' in s));
    suite.check('options: no CSP violations (worker, eval) while extracting', [docx, pdf].every((u) => cspErrors(u.page).length === 0), [docx, pdf].flatMap((u) => cspErrors(u.page)).join(' | '));
    const stored = await ext.sw.evaluate(`chrome.storage.local.get('resume').then((r) => ({ keys: Object.keys(r.resume ?? {}).sort().join(), textHas: (r.resume?.extractedText ?? '').includes('Analytical Engine') }))`);
    suite.check('storage: { filename, mimeType, size, base64, extractedText, uploadedAt }; text extracted',
      stored.keys === 'base64,extractedText,filename,mimeType,size,uploadedAt' && stored.textHas, JSON.stringify(stored));

    // ---- fixture page ----
    const fx = await open(ext, 'resume-cases.html');
    await fx.evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'existing.pdf', { type: 'application/pdf' })); document.getElementById('cv-existing').files = dt.files; })()`);
    fx.reply = await browser.injectAndFill(ext, fx.url);
    const plain = await fileState(fx, 'r-plain');
    suite.check('plain "Resume" input: the exact file attached (name, type, size, bytes)',
      plain.count === 1 && plain.name === 'dummy-resume.pdf' && plain.type === 'application/pdf' && plain.b64 === PDF_B64, JSON.stringify({ ...plain, b64: plain.b64?.slice(0, 12) }));
    const events = await fx.evaluate('window.__events');
    suite.check('input and change fired, bubbling', events.includes('input:r-plain') && events.includes('change:r-plain'), events.join(','));
    suite.check('Lever-style hidden input inside a visible "ATTACH RESUME/CV" link: attached', (await fileState(fx, 'r-lever')).name === 'dummy-resume.pdf');
    const untouched = {};
    for (const id of ['cover', 'portfolio', 'r-hidden', 'r-images', 'r-disabled', 'r-revert']) untouched[id] = (await fileState(fx, id)).count;
    suite.check('cover letter, portfolio, invisible, image-only, disabled inputs never touched', Object.values(untouched).every((c) => c === 0), JSON.stringify(untouched));
    suite.check('a file already attached is never overwritten', (await fileState(fx, 'cv-existing')).name === 'existing.pdf');
    const fill = tableAfter(fx, 'fill:');
    const reason = (label) => fill.find((r) => r.field.startsWith(label))?.reason;
    suite.check('per-field reasons: already has a file, not visible, file type not accepted, page reverted',
      reason('CV') === 'already has a file' && reason('Upload your resume') === 'not visible' && reason('Resume (image scan)') === 'file type not accepted' && reason('Resume (this page clears it)') === 'page reverted',
      JSON.stringify(fill.filter((r) => r.key === 'resume').map((r) => [r.field.slice(0, 24), r.status, r.reason])));
    suite.check('first name still filled alongside', (await fx.evaluate('first.value')) === TEST_PROFILE.firstName);
    suite.check('fill reply: resume attached, overlay shown', fx.reply?.ok && fx.reply.data.resumeAttached === true && fx.reply.data.resumeMissing === false && fx.reply.data.overlayShown, JSON.stringify(fx.reply?.data));

    const rows = (await inOverlay(browser, fx, RESULT_ROWS))?.results ?? [];
    const resumeRows = rows.filter((r) => r.text.includes('Resume attached: dummy-resume.pdf'));
    suite.check('overlay: "Resume attached: dummy-resume.pdf" rows, styled for review', resumeRows.length === 2 && resumeRows.every((r) => r.cls.includes('review')), rows.map((r) => r.text.slice(0, 50)).join(' | '));
    suite.check('overlay: filename only, never a path', rows.every((r) => !/[\\/]Users|fakepath|[A-Z]:\\/.test(r.text)));
    suite.check('overlay: reverted attach shown as "Didn’t stick"', rows.some((r) => r.cls.includes('failed') && r.text.includes('page reverted')));
    const summary = (await inOverlay(browser, fx, '.summary'))?.results[0]?.text ?? '';
    suite.check('overlay summary mentions the resume', /resume attached/.test(summary), summary);

    await clickInOverlay(browser, fx, UNDO_BUTTON);
    await sleep(200);
    const afterUndo = [(await fileState(fx, 'r-plain')).count, (await fileState(fx, 'r-lever')).count, (await fileState(fx, 'cv-existing')).name];
    suite.check('Undo removes the attached resume, keeps the user’s own file', afterUndo[0] === 0 && afterUndo[1] === 0 && afterUndo[2] === 'existing.pdf', JSON.stringify(afterUndo));

    // ---- never auto-dismissed: Lever-style page where everything else is high-confidence ----
    const lever = await open(ext, 'lever-like.html');
    lever.reply = await browser.injectAndFill(ext, lever.url);
    const leverRows = (await inOverlay(browser, lever, RESULT_ROWS))?.results ?? [];
    suite.check('Lever-style fixture: resume attached; it is the only row to review', leverRows.filter((r) => r.cls.includes('review')).length === 1
      && leverRows.some((r) => r.text.includes('Resume attached: dummy-resume.pdf')), leverRows.map((r) => r.text.slice(0, 40)).join(' | '));
    await sleep(7000);
    suite.check('a resume upload keeps the overlay open (never auto-dismissed)', await overlayPresent(lever));

    // ---- React ----
    const react = await open(ext, 'react-resume.html');
    await browser.injectAndFill(ext, react.url);
    const st = await react.evaluate('window.__resumeState');
    await react.evaluate('window.__rerender()');
    await sleep(150);
    const kept = await fileState(react, 'react-resume');
    suite.check('React: onChange saw the file, and it survives a re-render', st.picked === 'dummy-resume.pdf' && kept.name === 'dummy-resume.pdf' && (await react.evaluate('window.__resumeState.renders')) === 1,
      JSON.stringify({ st, kept: kept.name }));
    const reactFill = tableAfter(react, 'fill:');
    suite.check('React: an input remounted on change is reported "page reverted", not filled',
      reactFill.find((r) => r.field === 'Upload CV')?.reason === 'page reverted', JSON.stringify(reactFill.map((r) => [r.field, r.status, r.reason])));

    // ---- privacy ----
    // Slices from the start, middle and end of the file's base64 (the fixture is small, so pick offsets inside it).
    const b64Slices = [0, Math.floor(PDF_B64.length / 2), PDF_B64.length - 41].map((i) => PDF_B64.slice(i, i + 40));
    const leaked = leakedValues(pages, [...b64Slices, 'Analytical Engine notes']);
    suite.check('no resume bytes or extracted text in any console output (page, options, service worker)', leaked.length === 0, leaked.join(', '));

    // ---- no resume uploaded ----
    await docx.page.evaluate(`chrome.runtime.sendMessage({ type: 'DELETE_RESUME' })`);
    const none = await open(ext, 'resume-cases.html');
    none.reply = await browser.injectAndFill(ext, none.url);
    const noneFill = tableAfter(none, 'fill:');
    suite.check('no resume: field skipped with "no resume uploaded", nothing attached',
      noneFill.find((r) => r.field === 'Resume')?.reason === 'no resume uploaded' && (await fileState(none, 'r-plain')).count === 0, JSON.stringify(noneFill.filter((r) => r.key === 'resume').map((r) => r.reason)));
    const noneSummary = (await inOverlay(browser, none, '.summary'))?.results[0]?.text ?? '';
    suite.check('no resume: reply and overlay say so', none.reply?.data?.resumeMissing === true && none.reply.data.resumeAttached === false && /no resume uploaded/.test(noneSummary), noneSummary);

    // ---- production build: upload + attach work there too ----
    const prodExt = await browser.loadExtension(extensionWithHostAccess(prodDist));
    const prodUpload = await uploadViaOptions(browser, prodExt, PDF);
    const prodPage = await browser.open(uniqueUrl(`${server.origin}/resume-cases.html`));
    const prodReply = await browser.injectAndFill(prodExt, prodPage.url);
    suite.check('production build: upload, extraction and attach work', prodUpload.status === 'Resume saved ✓' && prodReply?.data?.resumeAttached === true
      && (await fileState(prodPage, 'r-plain')).name === 'dummy-resume.pdf', `${prodUpload.status} ${JSON.stringify(prodReply?.data)}`);
    suite.check('production build: nothing logged', [prodPage, prodUpload.page, prodExt.sw].every((p) => p.consoleCalls.length === 0));

    // ---- live Lever: detect, resolve, and stop short of attaching ----
    if (live) {
      const json = (url) => fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
      const posting = (await json('https://api.lever.co/v0/postings/palantir?mode=json&limit=1').catch(() => []))[0];
      if (!posting?.applyUrl) {
        suite.check('LIVE Lever: found a posting', false, 'Lever API returned nothing');
      } else {
        // A fresh extension with no profile and no resume: nothing is filled or sent to Lever.
        const liveExt = await browser.loadExtension(extensionWithHostAccess(devDist, ['https://jobs.lever.co/*']));
        const page = await browser.open(posting.applyUrl, 3500);
        const reply = await browser.injectAndFill(liveExt, posting.applyUrl);
        const liveFill = tableAfter(page, 'fill:');
        const resumeRow = liveFill.find((r) => r.key === 'resume');
        const files = await page.evaluate(`[...document.querySelectorAll('input[type=file]')].map((i) => i.files.length)`);
        suite.check('LIVE Lever: resume field resolved and passed every check up to the attach ("no resume uploaded")',
          resumeRow?.reason === 'no resume uploaded' && reply?.data?.resumeMissing === true, JSON.stringify({ resumeRow, files }));
        suite.check('LIVE Lever: no file attached, nothing sent', files.every((n) => n === 0));
      }
    }
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
