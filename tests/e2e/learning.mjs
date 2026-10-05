// Phase 3: "Teach this". test-page/learn-cases.html marks what the "Not filled"
// list should offer (data-teach). Covers both cases end to end:
//   case 1  unknown question → answer      (resolver Tier 3, learned)
//   case 2  known key, option didn't match → option wording means saved answer (filler fallback)
// plus edit/delete in Options, trusted clicks only, and nothing leaking.
import {
  clickInOverlay, extensionWithHostAccess, inOverlay, launchChrome, leakedValues, overlayPresent, RESULT_ROWS, serveFixtures, sleep, Suite,
  tableAfter, TEST_PROFILE, uniqueUrl,
} from './lib/harness.mjs';

const PROFILE = { ...TEST_PROFILE, veteranStatus: 'not_veteran' };
const TAUGHT_TEXT = ['LinkedIn', 'A friend', 'Line one'];

export async function run({ devDist }) {
  const suite = new Suite('learning (Teach this)');
  const server = await serveFixtures();
  const browser = await launchChrome();
  const pages = [];
  const fill = async () => {
    const page = await browser.open(uniqueUrl(`${server.origin}/learn-cases.html`));
    pages.push(page);
    page.reply = await browser.injectAndFill(ext, page.url);
    return page;
  };
  const teachRows = async (page) => (await inOverlay(browser, page, '.teach-row'))?.results ?? [];
  const rowIndex = (rows, label) => rows.findIndex((r) => r.text.startsWith(label));
  let ext;
  try {
    ext = await browser.loadExtension(extensionWithHostAccess(devDist));
    suite.check('profile saved (veteran: not a protected veteran)', (await browser.saveProfile(ext, PROFILE))?.ok === true);

    // ---- first visit: nothing fillable, five things to teach ----
    const first = await fill();
    const rows = await teachRows(first);
    const labels = rows.map((r) => r.text.split('Teach this')[0]);
    suite.check('"Not filled" lists exactly the teachable fields; the known-question option failure first',
      rows.length === 5 && labels[0] === 'Veteran status' && ['How did you hear about us?', 'Preferred work arrangement', 'Are you open to contract roles?', "Tell us about a project you're proud of"].every((l) => labels.includes(l)),
      JSON.stringify(labels));
    const summary = (await inOverlay(browser, first, '.summary')).results[0].text;
    suite.check('summary when nothing was filled', summary.startsWith('Nothing new filled') && summary.includes('5 to teach'), summary);
    suite.check('the popup is told an overlay is showing', first.reply?.data?.overlayShown === true && first.reply.data.teachable === 5);

    await clickInOverlay(browser, first, '.teach-row button', rowIndex(rows, 'How did you hear'));
    let after = await teachRows(first);
    suite.check('Teach before answering: asks you to answer on the page first, learns nothing',
      after[rowIndex(after, 'How did you hear')].text.includes('Answer it on the page first'));

    // Answer on the page, as the user would.
    await first.evaluate(`(() => {
      const setSel = (sel, text) => { const el = document.querySelector(sel); el.value = [...el.options].find((o) => o.text === text).value; el.dispatchEvent(new Event('change', { bubbles: true })); };
      setSel('#vet', "No, I'm not a veteran");
      setSel('#arr', 'Remote');
      document.querySelector('#hear').value = 'LinkedIn';
      document.querySelector('#proj').value = 'Line one\\nLine two';
      document.querySelector('input[name=contract][value=yes]').click();
    })()`);

    // Synthetic clicks from page script are ignored, on Teach and on Teach all.
    await inOverlay(browser, first, '.teach-row button', 'function(){ this.click(); }');
    await inOverlay(browser, first, 'button.teach-all', 'function(){ this.click(); }');
    await sleep(300);
    after = await teachRows(first);
    suite.check('synthetic (untrusted) clicks on Teach and Teach all are ignored', after.every((r) => !r.cls.includes('taught')));

    // Untick one row, then Teach all: only the ticked rows are taught.
    await clickInOverlay(browser, first, '.teach-row .teach-include', rowIndex(after, 'Tell us about a project'));
    const allLabel = (await inOverlay(browser, first, 'button.teach-all')).results[0].text;
    suite.check('unticking a row leaves it out: the button reads "Teach 4 selected"', allLabel === 'Teach 4 selected', allLabel);
    await clickInOverlay(browser, first, 'button.teach-all');
    await sleep(600);
    after = await teachRows(first);
    const tally = (await inOverlay(browser, first, '.teach-tally')).results[0].text;
    suite.check('Teach all taught the four ticked rows and skipped the unticked one',
      after.filter((r) => r.cls.includes('taught')).length === 4 && !after[rowIndex(after, 'Tell us about a project')].cls.includes('taught') && tally === 'Learned 4.',
      `${tally} | ${after.map((r) => (r.cls.includes('taught') ? '✓' : '·')).join('')}`);

    // The unticked row can still be taught on its own.
    await clickInOverlay(browser, first, '.teach-row button', rowIndex(after, 'Tell us about a project'));
    await sleep(300);
    after = await teachRows(first);
    const vet = after[rowIndex(after, 'Veteran status')];
    suite.check('all five taught; case 2 confirms what the option means',
      after.every((r) => r.cls.includes('taught')) && vet.text.includes(`"No, I'm not a veteran" means "I am not a protected veteran"`), after.map((r) => r.text.slice(-60)).join(' | '));

    // ---- what was stored ----
    const opt = await browser.open(`chrome-extension://${ext.id}/options/options.html`, 1500);
    const learned = (await opt.evaluate(`chrome.runtime.sendMessage({ type: 'GET_LEARNED' })`)).data;
    suite.check('stored as two maps: 4 question → answer, 1 option wording → code',
      Object.keys(learned.answers).length === 4 && Object.values(learned.optionSynonyms.veteranStatus ?? {}).map((o) => `${o.optionText}=${o.code}`).join() === "No, I'm not a veteran=not_veteran",
      JSON.stringify(Object.values(learned.answers).map((a) => [a.question, a.kind])));
    suite.check('no site or URL stored with learned answers', !JSON.stringify(learned).includes('127.0.0.1') && !/https?:/.test(JSON.stringify(learned)));
    const refused = await opt.evaluate(`chrome.runtime.sendMessage({ type: 'LEARN_ANSWER', question: 'Q', answer: 'A', kind: 'text' })`);
    suite.check('"Teach" messages are refused from anything but a tab’s content script', refused.ok === false && refused.error === 'Not allowed');

    // ---- second visit: everything taught fills itself ----
    const second = await fill();
    const values = await second.evaluate(`({ vet: vet.value, hear: hear.value, arr: arr.selectedOptions[0].text, contract: document.querySelector('input[name=contract]:checked')?.value ?? null, proj: proj.value })`);
    suite.check('both cases fill on the next visit',
      values.vet === "No, I'm not a veteran" && values.hear === 'LinkedIn' && values.arr === 'Remote' && values.contract === 'yes' && values.proj === 'Line one\nLine two', JSON.stringify({ ...values, hear: '…', proj: '…' }));
    const resolutions = second.consoleCalls.findLast((c) => c.args[1] === 'resolutions')?.args[2] ?? [];
    const learnedRes = resolutions.filter((r) => r.source === 'learned');
    suite.check('case 1 via resolver Tier 3: four "learned" resolutions at 0.85, answer not in evidence',
      learnedRes.length === 4 && learnedRes.every((r) => r.key === 'learned' && r.confidence === 0.85 && !TAUGHT_TEXT.some((t) => r.evidence.includes(t))));
    const vetDiag = tableAfter(second, 'selects:').find((r) => r.name === 'veteran_q');
    const vetRes = resolutions.find((r) => r.key === 'veteranStatus');
    suite.check('case 2 via the filler: still resolved as veteranStatus (dictionary); option matched through the learned wording',
      !!vetRes && vetRes.source === 'dictionary' && vetDiag?.['via learned'] === true && vetDiag?.status === 'filled', JSON.stringify(vetDiag));
    const resultRows = (await inOverlay(browser, second, RESULT_ROWS)).results;
    const learnedRows = resultRows.filter((r) => r.text.includes('learned · 85% · learned'));
    const flagged = (label) => learnedRows.find((r) => r.text.startsWith(label))?.cls.includes('review');
    suite.check('overlay: learned typed answers (text, textarea) flagged; learned dropdown/radio answers not; veteran (EEO) flagged',
      learnedRows.length === 4 && flagged('How did you hear about us?') === true && flagged("Tell us about a project you're proud of") === true
      && flagged('Preferred work arrangement') === false && flagged('Are you open to contract roles?') === false
      && resultRows.find((r) => r.text.includes('veteranStatus'))?.cls.includes('review'),
      learnedRows.map((r) => `${r.cls.includes('review') ? '[R] ' : ''}${r.text.slice(0, 30)}`).join(' | '));
    suite.check('nothing left to teach on this page', (await teachRows(second)).length === 0);

    // ---- Options page: edit and delete through the UI ----
    await browser.send('Page.reload', {}, opt.sessionId);
    await sleep(1500);
    const listed = await opt.evaluate(`({ answers: document.querySelectorAll('.learned-item.answer').length, options: [...document.querySelectorAll('.learned-item:not(.answer)')].map((li) => li.textContent) })`);
    suite.check('options page lists 4 answers and the option wording', listed.answers === 4 && listed.options.length === 1 && listed.options[0].includes('means "I am not a protected veteran"'), JSON.stringify(listed));
    await opt.evaluate(`(() => {
      const item = [...document.querySelectorAll('.learned-item.answer')].find((li) => li.textContent.includes('How did you hear about us?'));
      const ta = item.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'A friend');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(100);
    await opt.evaluate(`[...document.querySelectorAll('.learned-item.answer')].find((li) => li.textContent.includes('How did you hear about us?')).querySelector('button').click()`);
    await sleep(300);
    await opt.evaluate(`[...document.querySelectorAll('.learned-item.answer')].find((li) => li.textContent.includes('Preferred work arrangement')).querySelector('button.secondary').click()`);
    await sleep(300);
    const third = await fill();
    const v3 = await third.evaluate(`({ hear: hear.value, arr: arr.value })`);
    const rows3 = await teachRows(third);
    suite.check('edited answer is used; deleted one is no longer filled and is teachable again',
      v3.hear === 'A friend' && v3.arr === '' && rows3.length === 1 && rows3[0].text.startsWith('Preferred work arrangement'), JSON.stringify({ arr: v3.arr, teach: rows3.length }));
    await clickInOverlay(browser, third, 'button.teach-all');
    await sleep(400);
    const tally3 = (await inOverlay(browser, third, '.teach-tally')).results[0].text;
    suite.check('Teach all with an unanswered field: nothing learned, says it needs an answer first',
      tally3 === 'Learned 0 · 1 needs an answer on the page first.' && !(await teachRows(third))[0].cls.includes('taught'), tally3);

    // Delete all (accepting the confirm dialog).
    browser.send('Page.enable', {}, opt.sessionId);
    const dialogHandled = new Promise((resolve) => {
      const iv = setInterval(async () => {
        const r = await browser.send('Page.handleJavaScriptDialog', { accept: true }, opt.sessionId).catch(() => null);
        if (r) { clearInterval(iv); resolve(true); }
      }, 100);
      setTimeout(() => { clearInterval(iv); resolve(false); }, 5000);
    });
    opt.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete all learned answers').click()`).catch(() => {});
    await dialogHandled;
    await sleep(400);
    const cleared = (await opt.evaluate(`chrome.runtime.sendMessage({ type: 'GET_LEARNED' })`)).data;
    suite.check('"Delete all learned answers" empties both maps', Object.keys(cleared.answers).length === 0 && Object.keys(cleared.optionSynonyms).length === 0);

    // A teach-only panel doesn't auto-dismiss.
    const fourth = await fill();
    await sleep(7000);
    suite.check('a panel that only offers teaching stays until closed', await overlayPresent(fourth));

    const leaked = leakedValues(pages, TAUGHT_TEXT);
    suite.check('taught text answers never appear in console output', leaked.length === 0, leaked.join(', '));
  } finally {
    browser.close();
    server.close();
  }
  return suite;
}
