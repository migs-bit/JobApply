# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **"Teach this" (learning system).** Fields the extension couldn't fill are listed under "Not filled" in the panel. Answer one on the page, click Teach this, and it's remembered:
  - **Custom questions:** remembered as question → answer, used by a new resolver **Tier 3 (learned)**, at 0.85 confidence.
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
