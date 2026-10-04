# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

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
