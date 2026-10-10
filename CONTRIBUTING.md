# Contributing

Thanks for helping. Two rules are non-negotiable:
- **No network code.** The extension makes no requests, and its CSP enforces that.
- **No profile text values in logs,** in any build. See [SECURITY.md](SECURITY.md).

## Build and test

```bash
npm ci                 # install (npm install scripts are disabled via .npmrc)
npm run dev            # dev build into dist/, rebuilds on change, debug logging on
npm test               # unit tests
npm run test:e2e       # browser end-to-end suites (needs Chrome; see Tests below)
npm run build          # typecheck + unit tests + production build into dist/
```

Load `dist/` at `chrome://extensions` → **Load unpacked**, and reload it after each build.

Before opening a PR, run `npm run build` and `npm run test:e2e`. For matching changes, also run `npm run test:e2e:live`, which checks real Lever, Ashby and Replit postings read-only.

## Tests

Two layers: fast unit tests for the pure logic, and browser end-to-end suites that drive the built extension in a real (headless) Chrome.

### Unit tests

```bash
npm test
```

- `tests/*.test.ts`, run with Node's built-in test runner. `scripts/test.mjs` bundles them first, so imports resolve the way they do in the extension.
- They also run on every `npm run build`.
- They cover the resolver tiers, the dictionary and its false-positive guards, the fill plan, the dropdown choice/synonym table and option matching, profile validation, the popup's status wording, and the resume: its dictionary key, validation, storage round trip, and text extraction from the dummy PDF and DOCX.

### Browser end-to-end tests

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
| `robust-fill` | Fills with the page in the background (as with the popup open). A control showing the old input+change fill leaves blur-committed React state empty. React form read on submit: controlled inputs, a controlled select, and blur-committed fields all match what was filled. The exact event order each field receives. Values reverted after 50 ms reported as "page reverted", yellow, outlined, panel kept open. Dev event log (no values); production logs nothing. With `--live`, Lever and Ashby fill and nothing reverts. |
| `profile-keys` | Choice dropdowns on the options page. Every outcome in `eeo-cases.html`. Synonym matching. Per-`<select>` diagnostics. The Lever-style EEO section. With `--live`, a real Lever EEO form. |

**Live mode:** live postings change or close. The live checks look postings up through public job-board APIs where possible, and skip with a note if a page no longer has what they test.

**Never submits:** no suite submits a form. The live suites type only obviously fake test data (`ada@example.com`), into pages that are closed afterwards.

### Fixtures

- `test-page/`: pages served to the browser suites, also usable by hand (`python3 -m http.server 8000 --directory test-page`).
  - `index.html`: a sample application.
  - `scanner-cases.html`, `filler-cases.html`, `eeo-cases.html`, `radio-cases.html`, `learn-cases.html`, `resume-cases.html`, `robust-cases.html`: each control (or a radio group's first radio) declares its expected result in `data-expect-*` attributes.
  - `lever-like.html`: Lever's markup structure, with content written for this project. Used instead of saved copies of real postings.
- `tests/e2e/fixtures/`: small sources bundled at test time: a React form, React radio groups, React file inputs, a React form read on submit, and an entry that exposes the filler for direct guard tests.
- `tests/fixtures/`: `dummy-resume.pdf` and `dummy-resume.docx`, obviously fake resumes ("Ada Lovelace - DUMMY TEST RESUME") used by the unit and browser tests. Also handy for trying the feature by hand.

### Adding a suite

Create `tests/e2e/<name>.mjs` exporting `async function run({ devDist, prodDist, live })` that returns a `Suite` (see `tests/e2e/lib/harness.mjs`), then add `<name>` to `SUITES` in `tests/e2e/run.mjs`. The harness handles launching Chrome, loading the extension, serving fixtures, filling, and reading the overlay and logs.

## Add a profile key

1. **Type:** add the field to `Profile` in `src/shared/types.ts`.
2. **Key list:** add it to `PROFILE_KEYS` in `src/shared/constants.ts`. A compile-time check fails if you forget. Add it to a group there if it applies:
   - `URL_KEYS`: must be an http(s) URL.
   - `ALWAYS_REVIEW_KEYS`: every fill flagged for review. Use this for anything sensitive.
   - `EEO_KEYS`: only matched from labels and names, never from question prose.
3. **Options page:** add an input in `src/options/fields.ts`. Use `kind: 'choice'` for multiple-choice answers (see the next section).
4. **Matching:** add patterns in `src/background/resolver/dictionary.ts` (next section but one). If dropdowns should be able to hold it, add it to the `select` set in `COMPATIBLE_KEYS` in `src/background/resolver/field-rules.ts`.
5. **Validation:** for special formats, add a rule in `src/shared/profile-validation.ts`. Sanitizing (control characters, length caps) applies to every key automatically.
6. **Tests:** add unit tests (see `tests/profile-keys.test.ts`), and a case to a fixture page if it fills differently.

## Add a synonym to the dropdown choice table

Multiple-choice answers (EEO, work eligibility) live in `CHOICES` in `src/shared/choices.ts`. The profile stores a code (`not_veteran`); each code lists the option texts that mean it.

- **Order matters:** put the most specific wording first. The first synonym that equals exactly one option wins.
- **Whole-string matching:** synonyms are compared to option text (or value) as whole strings, after normalizing case, punctuation and spacing. Never as substrings, so a short synonym like "No" only matches an option that says exactly "No".
- **Integrity test:** a synonym that would mean two different answers for the same question fails `tests/choices.test.ts`.
- **Tests:** add a case to `tests/choices.test.ts` with the real option text, and say which form uses that wording.
- **New answers:** adding a new code (a new answer) also adds it to the options-page dropdown automatically.

## Add a dictionary pattern

Field matching lives in `src/background/resolver/dictionary.ts`.

- **`FIELD_PATTERNS`** (Tier 2): regexes per key.
  - **Order matters:** the first key that matches wins, so specific keys come first. Question keys come before address keys.
  - Patterns run on **normalized** text (`normalizeForMatching` in `tier-dictionary.ts`): lowercase, camelCase split, `_ - . [ ] ( ) : * ✱` turned into spaces. Use `\b` word boundaries.
- **`KEY_EXCLUSIONS`:** wording where a key's word means something else ("please *state*", "*current* salary", "relocation *assistance*").
- **`PROSE_KEYS`:** keys whose patterns are specific enough to match long question text around a field.
- **`NEGATIVE_CONTEXT`:** "someone else's details" (referrer, company…). Question keys are exempt.
- **`FUZZY_SYNONYMS`** (Tier 4): phrases for word-overlap matching. Keep them specific; a bare "url" or "name" re-creates false positives.
- **`AUTOCOMPLETE_MAP`** (Tier 1): browser-standard `autocomplete` tokens.

Every change needs unit tests in `tests/resolver.test.ts` (or `fuzzy.test.ts` / `profile-keys.test.ts`), with both the case it fixes and a case it must *not* match.

## Learned answers ("Teach this")

`src/background/storage/learned-store.ts` holds two maps with two lookup paths. Keep them separate:
- **`answers`** (question → answer): read by resolver Tier 3, `src/background/resolver/tier-learned.ts`.
- **`optionSynonyms`** (key → option text → choice code): sent as `learnedOptions` by `fill-plan.ts`, and tried by the dropdown and radio fillers through `matchChoice` in `src/content/filler/option-match.ts`.

Learned text must never be logged, and the full store must never go to a content script. Only the options page reads it (`GET_LEARNED`).

## Fill event sequence

Text fields and dropdowns are filled with a fixed sequence of calls and events (`src/content/filler/event-sequence.ts`), not a bare value assignment:

- **Text:** `focus()` → native value setter → `focus` → `focusin` → `keydown` → `input` → `keyup` → `change` → `blur()` → `blur` → `focusout`.
- **Dropdowns:** `focus()` → `option.selected` + `selectedIndex` + native `value` setter → `focus` → `focusin` → `mousedown` → `mouseup` → `click` (on the option) → `click` → `input` → `change` → `blur()` → `blur` → `focusout`.

Why it matters:
- **Frameworks listen for different things.** React reads `input`, and `change` on selects. Form libraries often commit a value to their own state only on blur, validate on `keyup`, or mark fields "touched" on focus. Firing only `input` + `change` let a page *show* a value while its state stayed empty, and the form submitted the field blank.
- **`focusin`/`focusout` must be dispatched by hand.** React's `onFocus`/`onBlur` use them. The popup holds keyboard focus during a fill, and in a page without focus `element.focus()`/`blur()` fire nothing.
- **The native value setter** bypasses React's wrapped `value` setter; otherwise React ignores the `input` event.

Rules when changing it:
- **The order is tested:** `tests/robust-fill.test.ts` (the sequence) and the `robust-fill` browser suite (what the page receives, plus React state read on submit). Change both together.
- **Check the result, not the events.** The verification pass (`verify.ts`) re-reads each field 200 ms after filling and reports "page reverted". Don't weaken it to make a site pass.
- **Never log values.** The dev diagnostics log step names only, not the value or the key typed.

## Add a site adapter (planned)

Site adapters (Tier 5) don't exist yet; see [ROADMAP.md](ROADMAP.md). The intended shape, so early work stays consistent:

- **One file per site** in `src/background/resolver/adapters/<site>.ts`, exporting a pure tier function: `(field: FieldCandidate, profile: Profile) => ResolvedField | null`.
- **Running order:** adapters run in `TIERS` in `src/background/resolver/field-resolver.ts`, only for their site, and only where the generic tiers fall short.
- **Evidence:** record why the adapter matched, like the other tiers.
- **Tests:** a fixture page in `test-page/` reproducing the site's markup *structure* with our own content (no copies of real postings), plus unit tests and an E2E check.

Until then, the most useful contribution for a site is a bug report with the dev-build console tables.

## Conventions

- **TypeScript:** strict mode, no `any` without a comment explaining why.
- **Files:** small, under about 200 lines where reasonable.
- **Comments:** explain *why*, not *what*.
- **Dependencies:** none beyond React and Vite without a strong reason. Dependency versions are pinned exactly. The current exceptions are `pdfjs-dist` and `mammoth`, which read resume text locally and load only on the options page.
- **Fixture pages:** declare expected results on each control (`data-expect-*`).
- **Docs:** `README.md` (user-facing) and `ROADMAP.md` are the living docs. Note user-visible changes under `[Unreleased]` in `CHANGELOG.md`. Scratch notes (`prompt.md`, `todo.md`, `scratch*.md`, `*.local.md`) are git-ignored and aren't specs.
