# Tests

Two layers: fast unit tests for the pure logic, and browser end-to-end suites that drive the built extension in a real (headless) Chrome.

## Unit tests

```bash
npm test
```

- `tests/*.test.ts`, run with Node's built-in test runner. `scripts/test.mjs` bundles them first, so imports resolve the way they do in the extension.
- They also run on every `npm run build`.
- They cover the resolver tiers, the dictionary and its false-positive guards, the fill plan, the dropdown choice/synonym table and option matching, profile validation, the popup's status wording, and the resume: its dictionary key, validation, storage round trip, and text extraction from the dummy PDF and DOCX.

## Browser end-to-end tests

```bash
npm run test:e2e                     # all offline suites (fixture pages only)
npm run test:e2e -- fill overlay     # only some suites
npm run test:e2e:live                # also check live Lever/Ashby/Replit postings (needs network)
```

**Requirements:** Chrome or Chromium. The harness looks in the standard install locations; set `CHROME_PATH` otherwise.

**How it runs:** `tests/e2e/run.mjs` builds a dev and a production copy of the extension into temp folders (your `dist/` is untouched). Each suite then gets its own throwaway headless Chrome profile.

**How the extension is driven:**
- It's loaded through the DevTools protocol (`Extensions.loadUnpacked`), because branded Chrome ignores `--load-extension`.
- Headless Chrome can't click the toolbar icon, so most suites load a copy whose manifest adds host access for `127.0.0.1`. That stands in for the click's `activeTab` grant.
- The real manifest is tested separately: that permissions are minimal, and that without a click there's no access.

| Suite | Covers |
|---|---|
| `extension` | Manifest and CSP accepted. Options page save/reload. Message guard and sanitizing. **Zero network requests**, checked with a canary server. No inline scripts. Web pages can't message the extension. |
| `scanner` | Every expectation in `scanner-cases.html`. No injection without a click. Prefilled values never read. Stable IDs. Production build logs nothing. |
| `resolve` | Content script → service worker → resolutions, on the sample form and `lever-like.html`. With `--live`, real postings are checked read-only (no profile saved). |
| `fill` | Every outcome in `filler-cases.html`, including hidden-field phishing variants. React state updated. Lever-style fields. The filler's guards called directly. No values in logs. |
| `popup` | Permissions and install warnings (none). The real popup opened over a tab: inject once, fill, close itself when the overlay shows, explain why when nothing was filled. |
| `overlay` | Closed shadow root, rows and review highlighting, Undo (keeps user edits, resets React state), Close and Esc, auto-dismiss. A strict page CSP plus hostile page CSS. |
| `radio` | Every group outcome in `radio-cases.html`: fills, ambiguous, no-match, preselected and hidden skips, untouched custom questions. React radios: the click updates state; a refused click reports "page reverted". Undo keeps the page and React state consistent. Review highlighting. With `--live`, a real Lever form's radio questions and EEO dropdowns. |
| `learning` | "Teach this" end to end on `learn-cases.html`:
- the teach list, the "answer it first" guard, synthetic clicks ignored;
- Teach all: unticked rows left out, and unanswered rows reported;
- teaching both cases, with storage as two maps and no URL kept;
- reuse on the next visit (Tier 3 for questions, the filler's learned wordings for options);
- edit, delete and delete-all in Options;
- no taught text in logs. |
| `resume` | Upload through the real options page: `.txt`, 6 MB and renamed files rejected; DOCX and PDF text extracted under the extension CSP. Every outcome in `resume-cases.html`: the exact bytes attached, Lever-style hidden input, cover letter / portfolio / hidden / image-only untouched, an existing file kept, "page reverted". React: survives a re-render; a remounted input reports "page reverted". Review row, no auto-dismiss, Undo. "No resume uploaded". Production build. No file bytes or text in logs. With `--live`, a real Lever form, stopping short of attaching (no resume stored, nothing sent). |
| `profile-keys` | Choice dropdowns on the options page. Every outcome in `eeo-cases.html`. Synonym matching. Per-`<select>` diagnostics. The Lever-style EEO section. With `--live`, a real Lever EEO form. |

**Live mode:** live postings change or close. The live checks look postings up through public job-board APIs where possible, and skip with a note if a page no longer has what they test.

**Never submits:** no suite submits a form. The live suites type only obviously fake test data (`ada@example.com`), into pages that are closed afterwards.

## Fixtures

- `test-page/`: pages served to the browser suites, also usable by hand (`python3 -m http.server 8000 --directory test-page`).
  - `index.html`: a sample application.
  - `scanner-cases.html`, `filler-cases.html`, `eeo-cases.html`, `radio-cases.html`, `learn-cases.html`, `resume-cases.html`: each control (or a radio group's first radio) declares its expected result in `data-expect-*` attributes.
  - `lever-like.html`: Lever's markup structure, with content written for this project. Used instead of saved copies of real postings.
- `tests/e2e/fixtures/`: small sources bundled at test time: a React form, React radio groups, React file inputs, and an entry that exposes the filler for direct guard tests.
- `tests/fixtures/`: `dummy-resume.pdf` and `dummy-resume.docx`, obviously fake resumes ("Ada Lovelace - DUMMY TEST RESUME") used by the unit and browser tests. Also handy for trying the feature by hand.

## Adding a suite

Create `tests/e2e/<name>.mjs` exporting `async function run({ devDist, prodDist, live })` that returns a `Suite` (see `tests/e2e/lib/harness.mjs`), then add `<name>` to `SUITES` in `tests/e2e/run.mjs`. The harness handles launching Chrome, loading the extension, serving fixtures, filling, and reading the overlay and logs.
