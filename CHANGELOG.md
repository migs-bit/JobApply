# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Resume upload.** One PDF or DOCX resume (up to 5 MB), uploaded on a new **Options → Resume** section (Upload, Replace, Remove), attached to resume fields on **Fill this page**.
  - **Storage:** `chrome.storage.local`, with the same locked-down access as the profile, as `{ filename, mimeType, size, base64, extractedText, uploadedAt }`. No site or URL is kept.
  - **Text extraction:** the plain text (capped at 20,000 characters) is extracted once at upload, entirely in the extension, with PDF.js and mammoth. It's kept for the planned AI tier; nothing reads it yet. If extraction fails, the file is still stored.
  - **Validation:** files over 5 MB and anything but PDF/DOCX are rejected with a clear message. The service worker re-checks the decoded bytes, including the file signature.
  - **Matching:** a new `resume` key ("resume", "CV", "curriculum vitae", "attach/upload resume", "Résumé"), valid for `type="file"` inputs only. A field mentioning a cover letter, portfolio, writing sample or transcript never matches.
  - **Filling:** the file is put into the input with `DataTransfer`, `input` and `change` fire, and after 100 ms the filler checks the file stuck ("page reverted" otherwise, including when React swaps the input out). A file already attached is never replaced.
  - **Visibility:** a file input counts as visible when it, its label, or the upload button wrapped around it is (Lever hides the native input inside an "ATTACH RESUME/CV" button). Fully hidden file inputs are never touched.
  - **Panel and popup:** "Resume attached: file.pdf" as a review row (filename only); the panel never auto-closes after attaching a file. Summaries say "resume attached", or "no resume uploaded" when a page asks for one and none is stored.
  - **Undo** removes the attached resume.
  - **Tests:** unit tests for the dictionary, storage, validation and extraction (dummy PDF and DOCX fixtures in `tests/fixtures/`), a `resume` browser suite, and a live Lever check that stops short of attaching.

- **"Teach this" (learning system).** Fields the extension couldn't fill are listed under "Not filled" in the panel. Answer one on the page, click Teach this, and it's remembered:
  - **Custom questions:** remembered as question → answer, used by a new resolver **Tier 3 (learned)**, at 0.85 confidence.
    - **Typed answers** (text fields, textareas) are always flagged for review, so they show yellow and the panel doesn't auto-close; a generic answer like "Why do you want to work here?" may not fit the next company.
    - **Learned dropdown and radio answers** aren't flagged.
  - **Known questions whose dropdown or radio options didn't match:** remembered as option text → your saved answer, tried by the fillers after the built-in synonyms. Diagnostics show "via learned".
  - **Teach all:** teaches every ticked row on show in one click. Untick a row to leave it out; unanswered rows are skipped with a reminder.
  - **Managing them:** an options-page **Learned answers** section to edit, delete, or delete all.
  - **Privacy:** stored locally with no site or URL, never logged, never sent to the page as a whole. Teach and Undo only respond to real clicks.

- **Radio button support.**
  - **One question per group:** radios sharing a name are one question, matched on the group's question text (a fieldset legend, a radiogroup label, or the text around it), never on a lone "Yes"/"No".
  - **Which questions:** only work-eligibility and EEO keys can be answered by a radio group.
  - **Real click:** the matching radio is clicked, then re-checked after 100 ms; a page that refuses the click is reported as "page reverted". Groups that already have an answer are never changed.
  - **Hidden radios:** a radio counts as visible if the radio *or* its label is, as with custom-styled radios. Fully hidden groups are never touched.
  - **Diagnostics:** one dev-build row per radio group, with the chosen option and the options on offer.

- **New profile fields:** desired salary, notice period, work authorization, visa sponsorship, willingness to relocate, and optional voluntary self-identification (gender, race/ethnicity, veteran status, disability status).
- **Native dropdown filling** for these fields, including Lever's EEO section and Yes/No question cards.
- **Dropdown synonym matching:** each answer is matched against the wordings forms commonly use ("I am not a veteran", "I am not a protected veteran", …).
  - Whole-text comparison, ignoring case, punctuation and spacing.
  - Ambiguous or missing matches are skipped, never guessed.
- **Dropdown diagnostics in dev builds:** one row per dropdown with the resolved key, the chosen option, the options available, and the outcome.
- **Browser end-to-end suites in the repo** (`npm run test:e2e`, plus `npm run test:e2e:live` for live job-board checks), and a Lever-style fixture page.
- **Docs:** `ROADMAP.md`, `CONTRIBUTING.md`, this changelog, and `tests/README.md`.
- **Build:** `scripts/build.mjs --out=<dir>`, which builds somewhere other than `dist/`.

### Changed

- **Robust fill: text fields and dropdowns are filled the way a person fills them,** so form frameworks record the value, not just the page. Before, some fields showed the value but submitted blank, because a framework committed the value to its state on blur (or focus, or key events) that never came.
  - **Text inputs and textareas:** `focus()`, native value setter, then `focus`, `focusin`, `keydown`, `input`, `keyup`, `change`, `blur()`, `blur`, `focusout`.
  - **Native dropdowns:** `focus()`; `option.selected`, `selectedIndex` and the native `value` setter all set; then `focus`, `focusin`, `mousedown`, `mouseup`, `click` on the option, `click`, `input`, `change`, `blur()`, `blur`, `focusout`.
  - **`focusin` / `focusout` are dispatched explicitly.** React's `onFocus`/`onBlur` listen for them. And while the popup has keyboard focus, the page has none, so `element.focus()`/`blur()` fire no events at all.
  - **Post-fill verification:** 200 ms after filling, every filled field (text, dropdown, radio, file) is re-read. One the page changed back is reported as failed, "page reverted".
  - **Failed rows are yellow** review rows now, with their fields outlined on the page. The panel never auto-dismisses when something failed.
  - **Dev builds** log the exact event sequence sent to each field (key, selector, events; never the value).
  - Radios (`.click()`) and file inputs (100 ms check) are unchanged, apart from the verification pass.
  - **Undo** uses the same sequences, so the page's state follows.

- **File inputs are now in scope, for the resume only.** Before, every `type="file"` input resolved to unknown.
- **New runtime dependencies:** `pdfjs-dist` 6.3.289 and `mammoth` 1.12.3, pinned exactly, loaded only on the options page when a resume is uploaded.

- **Tiers are numbered by run order:** 1 autocomplete, 2 dictionary, 3 learned, 4 fuzzy, 5 site adapters (planned), 6 AI (planned).
- **The panel now also appears when nothing was filled but something can be taught.** It doesn't auto-close in that case.

- **Undo for radio answers:** the answer stays in place and the panel says to change it on the page. A programmatic clear would leave React-style forms submitting the old answer while the page shows none. When a radio was selected before, Undo clicks it again.
- **The overlay shows the option actually chosen** for dropdowns and radios ("I am not a veteran"), not the generic answer label.
- **Field names in diagnostics and the overlay:** fields without a label (Lever card questions) are named by their question text, and diagnostics rows include the field's `name`.

- **Always flagged for review:** EEO, work-eligibility, relocation and salary answers, whatever the match confidence.
- **Question text can match for question-style keys only** (sponsorship, authorization, relocation, salary, notice period), at review-level confidence. This covers Lever's card questions. EEO keys still match labels and names only.
- **Guards against flipped answers:** questions mixing "authorized to work" and "without sponsorship" are left for you, as are relocation-assistance, current-salary, accommodation and citizenship questions.
- **Options page:** new Job preferences, Work eligibility and Voluntary self-identification sections. Multiple-choice answers are picked from dropdowns and stored as codes. Values saved as free text by earlier builds migrate automatically.
- **Dev logging:** dev builds now log which dropdown option was chosen. Text-field values are still never logged, and production builds have no debug logging. See `SECURITY.md`.
- **Salary questions:** "Please state your salary expectations" now resolves to desired salary.

### Fixed

- **Veteran status:** it didn't fill on Lever forms whose wording differed from the saved text.
- **Test fixture:** a stale expected skip reason in `filler-cases.html`.

## [0.1.0] - 2026-09-30

Tagged `mvp-v1`.

### Added

- **MVP: scanner, resolver, filler, popup, overlay.**
  - Generic DOM scanner: labels, unique selectors, context text, skip reasons. Injected only on click.
  - Resolver Tiers 1–3 (autocomplete, dictionary, fuzzy) in the service worker, with evidence for every match.
  - React-safe filler. It never overwrites, never truncates, and never fills hidden fields.
  - "Fill this page" popup, and a results panel with confidence, review highlighting, Undo and auto-dismiss.
  - Options page profile editor. Local-only storage, strict CSP, no network access, no telemetry.
